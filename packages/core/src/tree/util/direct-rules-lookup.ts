import type { Context } from '../../context.js';
import type { Declaration } from '../declaration.js';
import { Node } from '../node.js';
import { N } from '../node-type.js';
import { Rules } from '../rules.js';
import type { RulesOptions, RulesVisibility } from '../rules.js';
import { lookupScopeFrameVariable } from '../scope-frame.js';
import { isNode } from './is-node.js';
import {
  canEnterMixinOutputForLookup,
  canEnterRulesEntryForLookup,
  isOptionalRulesEntry,
  isPublicRulesEntry,
  type LookupVisibility
} from './mixin-output-slot.js';
import type { DeclarationFindOptions } from './lookup-utils.js';

type DirectDeclarationFindOptions = DeclarationFindOptions & {
  context?: Context;
};

type DeclarationLookupStrategy = {
  cacheTag: string;
  lookupVisibility: LookupVisibility;
  visibilityKey: 'VarDeclaration' | 'Declaration' | undefined;
  includeLiveBindings: boolean;
  includeFallbackFrames: boolean;
  prepareScopeFrame: boolean;
  acceptsNode: (node: Node) => node is Declaration;
  scopeMayContainFamily: (scope: Rules) => boolean;
  childEntryMayContainFamily: (entry: {
    hasDeclarationSurface?: boolean;
    hasVarDeclarationSurface?: boolean;
    hasReferenceImportSurface?: boolean;
  }) => boolean;
  skipVarsAfterBindingHit: boolean;
};

const DIRECT_LOOKUP_PROFILE_COUNTERS_KEY = '__JESS_DIRECT_LOOKUP_PROFILE_COUNTERS__';

type DirectLookupProfileGlobals = typeof globalThis & {
  [DIRECT_LOOKUP_PROFILE_COUNTERS_KEY]?: Record<string, number>;
};

const directLookupProfileGlobals = globalThis as DirectLookupProfileGlobals;
const directLookupProfileCounters = directLookupProfileGlobals[DIRECT_LOOKUP_PROFILE_COUNTERS_KEY];
const countDirectLookup = directLookupProfileCounters
  ? (event: string): void => {
      const counters = directLookupProfileCounters;
      counters[event] = (counters[event] ?? 0) + 1;
    }
  : undefined;

const VARIABLE_LOOKUP: DeclarationLookupStrategy = {
  cacheTag: 'v',
  lookupVisibility: 'VarDeclaration',
  visibilityKey: 'VarDeclaration',
  includeLiveBindings: true,
  includeFallbackFrames: true,
  prepareScopeFrame: true,
  acceptsNode: (node): node is Declaration => isNode(node, N.VarDeclaration),
  scopeMayContainFamily: scope => scope.hasVarDeclarationChildSurface || scope.hasReferenceImportChildSurface,
  childEntryMayContainFamily: entry => (
    entry.hasVarDeclarationSurface !== false || entry.hasReferenceImportSurface === true
  ),
  skipVarsAfterBindingHit: true
};

const VARIABLE_OCCURRENCE_LOOKUP: DeclarationLookupStrategy = {
  cacheTag: 'v',
  lookupVisibility: 'VarDeclaration',
  visibilityKey: 'VarDeclaration',
  includeLiveBindings: false,
  includeFallbackFrames: true,
  prepareScopeFrame: false,
  acceptsNode: (node): node is Declaration => isNode(node, N.VarDeclaration),
  scopeMayContainFamily: scope => scope.hasVarDeclarationChildSurface || scope.hasReferenceImportChildSurface,
  childEntryMayContainFamily: entry => (
    entry.hasVarDeclarationSurface !== false || entry.hasReferenceImportSurface === true
  ),
  skipVarsAfterBindingHit: false
};

const PROPERTY_LOOKUP: DeclarationLookupStrategy = {
  cacheTag: 'p',
  lookupVisibility: 'Declaration',
  visibilityKey: 'Declaration',
  includeLiveBindings: false,
  includeFallbackFrames: false,
  prepareScopeFrame: false,
  acceptsNode: (node): node is Declaration => isNode(node, N.Declaration),
  scopeMayContainFamily: scope => scope.hasDeclarationChildSurface || scope.hasReferenceImportChildSurface,
  childEntryMayContainFamily: entry => (
    entry.hasDeclarationSurface !== false || entry.hasReferenceImportSurface === true
  ),
  skipVarsAfterBindingHit: false
};

const ANY_DECLARATION_LOOKUP: DeclarationLookupStrategy = {
  cacheTag: 'd',
  lookupVisibility: 'Declaration',
  visibilityKey: undefined,
  includeLiveBindings: false,
  includeFallbackFrames: false,
  prepareScopeFrame: false,
  acceptsNode: (node): node is Declaration => isNode(node, N.Declaration | N.VarDeclaration),
  scopeMayContainFamily: scope => (
    scope.hasDeclarationChildSurface || scope.hasVarDeclarationChildSurface || scope.hasReferenceImportChildSurface
  ),
  childEntryMayContainFamily: entry => (
    entry.hasDeclarationSurface !== false || entry.hasVarDeclarationSurface !== false
    || entry.hasReferenceImportSurface === true
  ),
  skipVarsAfterBindingHit: false
};
const EMPTY_DIRECT_DECLARATION_FIND_OPTIONS: DirectDeclarationFindOptions = {};

export type DirectDeclarationOccurrence = {
  readonly kind: 'direct-declaration-occurrence';
  readonly node: Declaration;
  readonly ownerRules: Rules | undefined;
  readonly ownerLookupVersion: number | undefined;
  readonly index: number | undefined;
  readonly slot: number | undefined;
};

type DeclarationMatchState = {
  optionalMatch: DirectDeclarationOccurrence | undefined;
  publicMatch: DirectDeclarationOccurrence | undefined;
  readonly: boolean;
};

type CachedDeclarationMatchState = Readonly<DeclarationMatchState>;
const EMPTY_DECLARATION_MISS_STATE: DeclarationMatchState = {
  optionalMatch: undefined,
  publicMatch: undefined,
  readonly: false
};
const READONLY_EMPTY_DECLARATION_MISS_STATE: DeclarationMatchState = {
  optionalMatch: undefined,
  publicMatch: undefined,
  readonly: true
};

function isNonClassicImportBoundary(rules: Rules | undefined): boolean {
  return rules?.options.importBoundary === true;
}

function isRulesetBodyScope(rules: Rules): boolean {
  return isNode(rules.parent, N.Ruleset) || isNode(rules.sourceNode, N.Ruleset);
}

function getDeclarationVisibility(
  rules: Rules,
  strategy: DeclarationLookupStrategy
): RulesVisibility | undefined {
  return strategy.visibilityKey === undefined
    ? undefined
    : rules.options.rulesVisibility?.[strategy.visibilityKey];
}

function passesDeclarationFilter(
  node: Node,
  key: string,
  strategy: DeclarationLookupStrategy,
  options: Pick<
    DeclarationFindOptions,
    'excludedDeclarations' | 'filter' | 'requiredDeclarationAssignments'
  >,
  start: number | undefined
): node is Declaration {
  if (!strategy.acceptsNode(node)) {
    return false;
  }
  if (options.excludedDeclarations?.includes(node)) {
    return false;
  }
  if (node.options?.setDefined) {
    return false;
  }
  const requiredDeclarationAssignments = options.requiredDeclarationAssignments;
  if (requiredDeclarationAssignments !== undefined) {
    const normalizedFromAssign = String(node.options?.normalizedFromAssign ?? '');
    if (Array.isArray(requiredDeclarationAssignments)) {
      if (!requiredDeclarationAssignments.includes(normalizedFromAssign)) {
        return false;
      }
    } else if (normalizedFromAssign !== requiredDeclarationAssignments) {
      return false;
    }
  }
  if (String(node.name.valueOf()) !== key) {
    return false;
  }
  if (start !== undefined && !(node.index !== undefined && node.index < start)) {
    return false;
  }
  return !options.filter || options.filter(node);
}

function getDirectDeclarationBucket(
  scope: Rules,
  key: string
): Declaration[] | undefined {
  const buckets = scope.directDeclarationsByName ??= new Map<string, Declaration[] | null>();
  const cached = buckets.get(key);
  if (cached) {
    return cached;
  }
  if (buckets.has(key)) {
    return undefined;
  }

  let bucket: Declaration[] | undefined;
  const value = scope.rules;
  for (let i = 0; i < value.length; i++) {
    const node = value[i]!;
    if (!isNode(node, N.Declaration) && !isNode(node, N.VarDeclaration)) {
      continue;
    }
    if (node.options?.setDefined) {
      continue;
    }
    if (String(node.name.valueOf()) === key) {
      bucket ??= [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      bucket.push(node as Declaration);
    }
  }
  if (!bucket) {
    buckets.set(key, null);
    return undefined;
  }
  buckets.set(key, bucket);
  return bucket;
}

function chooseTraversalMatch(
  current: DirectDeclarationOccurrence | undefined,
  next: DirectDeclarationOccurrence | undefined
): DirectDeclarationOccurrence | undefined {
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  if (
    current.node.parent === next.node.parent
    && typeof current.index === 'number'
    && typeof next.index === 'number'
  ) {
    return current.index < next.index ? next : current;
  }
  if (
    current.node.parent === next.node.parent
    && typeof current.slot === 'number'
    && typeof next.slot === 'number'
  ) {
    return current.slot < next.slot ? next : current;
  }
  return current;
}

function createDeclarationOccurrence(
  node: Declaration,
  slot?: number
): DirectDeclarationOccurrence {
  const ownerRules = isNode(node.parent, N.Rules) ? node.parent : undefined;
  const key = String(node.name.valueOf());
  return {
    kind: 'direct-declaration-occurrence',
    node,
    ownerRules,
    ownerLookupVersion: ownerRules?.getDeclarationLookupVersion(key),
    index: node.index,
    slot
  };
}

export function isDirectDeclarationOccurrenceCurrent(
  occurrence: DirectDeclarationOccurrence
): boolean {
  return (
    occurrence.node.parent === occurrence.ownerRules
    && occurrence.ownerRules?.getDeclarationLookupVersion(String(occurrence.node.name.valueOf())) === occurrence.ownerLookupVersion
    && occurrence.node.index === occurrence.index
  );
}

function chooseCandidateMatch(
  current: DirectDeclarationOccurrence | undefined,
  candidates: Set<Node> | undefined,
  key: string,
  strategy: DeclarationLookupStrategy,
  options: Pick<
    DeclarationFindOptions,
    'excludedDeclarations' | 'filter' | 'requiredDeclarationAssignments'
  >
): DirectDeclarationOccurrence | undefined {
  if (!candidates?.size) {
    return current;
  }
  let out = current;
  for (const candidate of candidates) {
    if (passesDeclarationFilter(candidate, key, strategy, options, undefined)) {
      out = chooseTraversalMatch(out, createDeclarationOccurrence(candidate));
    }
  }
  return out;
}

function addCandidateMatch(
  candidates: Set<Node> | undefined,
  match: DirectDeclarationOccurrence | undefined
): void {
  if (candidates && match) {
    candidates.add(match.node);
  }
}

function getEmptyDeclarationMissState(readonly = false): DeclarationMatchState {
  return readonly ? READONLY_EMPTY_DECLARATION_MISS_STATE : EMPTY_DECLARATION_MISS_STATE;
}

function createTraversalMatchState(readonly = false): DeclarationMatchState {
  return {
    optionalMatch: undefined,
    publicMatch: undefined,
    readonly
  };
}

function getDeclarationParentSearchStep(
  rules: Rules,
  start: number | undefined,
  preserveLinearStart: boolean,
  ignoreParentScopeStart: boolean | undefined
): { rules: Rules | undefined; start: number | undefined } {
  let cursor: Node | undefined = rules;
  do {
    let containingNode: Node | undefined = cursor;
    while (containingNode?.parent && !isNode(containingNode.parent, N.Rules)) {
      containingNode = containingNode.parent;
    }
    cursor = cursor.parent;
    if (isNode(cursor, N.Rules) && isNonClassicImportBoundary(cursor)) {
      return { rules: undefined, start };
    }
    if (cursor && ignoreParentScopeStart) {
      start = undefined;
    } else if (cursor && preserveLinearStart) {
      start = getContainingNodeStart(containingNode) ?? start;
    }
  } while (cursor && !isNode(cursor, N.Rules));

  return { rules: isNode(cursor, N.Rules) ? cursor : undefined, start };
}

function getContainingNodeStart(node: Node | undefined): number | undefined {
  let cursor = node;
  while (cursor) {
    if (cursor.index !== undefined) {
      return cursor.index;
    }
    const parent = cursor.parent;
    if (isNode(parent, N.Rules)) {
      const index = parent.rules.indexOf(cursor);
      return index === -1 ? undefined : index;
    }
    cursor = parent;
  }
  return undefined;
}

function mergeMatch(
  target: DeclarationMatchState,
  source: CachedDeclarationMatchState,
  optionalOnly: boolean
): void {
  target.readonly ||= source.readonly;
  if (optionalOnly) {
    target.optionalMatch = chooseTraversalMatch(target.optionalMatch, source.publicMatch);
    target.optionalMatch = chooseTraversalMatch(target.optionalMatch, source.optionalMatch);
    return;
  }
  target.publicMatch = chooseTraversalMatch(target.publicMatch, source.publicMatch);
  target.optionalMatch = chooseTraversalMatch(target.optionalMatch, source.optionalMatch);
}

function getRecursiveLookupCacheKey(
  key: string,
  strategy: DeclarationLookupStrategy,
  options: DirectDeclarationFindOptions,
  start: number | undefined,
  local: boolean,
  readonly: boolean
): string | undefined {
  if (
    strategy.includeLiveBindings
    || start !== undefined
    || readonly
    || options.filter
    || options.excludedDeclarations
    || options.requiredDeclarationAssignments !== undefined
    || Boolean(options.candidates?.size)
    || Boolean(options.optionalCandidates?.size)
  ) {
    return undefined;
  }
  return [
    key,
    strategy.cacheTag,
    local ? 'l1' : 'l0',
    options.hasTarget ? 't1' : 't0'
  ].join('\u001f');
}

function readCachedMatch(scope: Rules, cacheKey: string | undefined): CachedDeclarationMatchState | undefined {
  if (!cacheKey) {
    return undefined;
  }
  const cached = scope.directDeclarationLookupCache?.get(cacheKey);
  if (!cached) {
    return undefined;
  }
  if (
    (cached.optionalMatch && !isDirectDeclarationOccurrenceCurrent(cached.optionalMatch))
    || (cached.publicMatch && !isDirectDeclarationOccurrenceCurrent(cached.publicMatch))
  ) {
    scope.directDeclarationLookupCache?.delete(cacheKey);
    return undefined;
  }
  return cached;
}

function writeCachedMatch(scope: Rules, cacheKey: string | undefined, state: CachedDeclarationMatchState): void {
  if (!cacheKey) {
    return;
  }
  (scope.directDeclarationLookupCache ??= new Map()).set(cacheKey, {
    optionalMatch: state.optionalMatch,
    publicMatch: state.publicMatch,
    readonly: state.readonly
  });
}

function findLocalDeclaration(
  scope: Rules,
  key: string,
  strategy: DeclarationLookupStrategy,
  options: Pick<
    DeclarationFindOptions,
    'excludedDeclarations' | 'filter' | 'requiredDeclarationAssignments'
  >,
  start: number | undefined,
  skipVarDeclarations = false
): DirectDeclarationOccurrence | undefined {
  const bucket = getDirectDeclarationBucket(scope, key);
  if (!bucket?.length) {
    return undefined;
  }
  for (let i = bucket.length - 1; i >= 0; i--) {
    const node = bucket[i]!;
    if (skipVarDeclarations && isNode(node, N.VarDeclaration)) {
      continue;
    }
    if (passesDeclarationFilter(node, key, strategy, options, start)) {
      return createDeclarationOccurrence(node, i);
    }
  }
  return undefined;
}

function findWithinScopeSurface(
  scope: Rules,
  key: string,
  strategy: DeclarationLookupStrategy,
  options: DirectDeclarationFindOptions,
  start: number | undefined,
  childStart: number | undefined,
  local: boolean,
  readonly: boolean,
  firstVisitedRules?: Rules,
  secondVisitedRules?: Rules,
  visited?: Set<Rules>
): DeclarationMatchState {
  if (firstVisitedRules === scope || secondVisitedRules === scope || visited?.has(scope)) {
    return getEmptyDeclarationMissState(readonly);
  }
  if (firstVisitedRules === undefined) {
    firstVisitedRules = scope;
  } else if (secondVisitedRules === undefined) {
    secondVisitedRules = scope;
  } else {
    visited ??= new Set<Rules>([firstVisitedRules, secondVisitedRules]);
    visited.add(scope);
  }
  const cacheKey = getRecursiveLookupCacheKey(key, strategy, options, start, local, readonly);
  const cached = readCachedMatch(scope, cacheKey);
  if (cached) {
    countDirectLookup?.('declaration.cacheHit');
    return cached;
  }
  countDirectLookup?.('declaration.cacheMiss');
  countDirectLookup?.(`declaration.scope.${strategy.cacheTag}`);

  const includeLiveBindings = strategy.includeLiveBindings && options.includeLiveBindings !== false;
  if (strategy.prepareScopeFrame && includeLiveBindings) {
    if (!scope._scopeFrame) {
      countDirectLookup?.('declaration.framePrep');
      scope.getScopeFrame(undefined, false);
    }
  }

  const state = createTraversalMatchState(readonly || Boolean(scope.options.readonly));
  let localMatch: DirectDeclarationOccurrence | undefined;
  let skipVarDeclarations = false;
  if (includeLiveBindings) {
    const frameHit = lookupScopeFrameVariable(scope._scopeFrame, key, {
      start,
      filter: options.filter,
      includeFallbackFrames: false,
      searchParents: false
    });
    const liveHit = frameHit.kind === 'live' ? frameHit : undefined;
    const liveSource = liveHit?.sourceNode;
    if (
      liveHit
      && liveSource
      && isNode(liveSource, N.VarDeclaration)
      && (!options.filter || options.filter(liveSource))
    ) {
      const liveOccurrence = createDeclarationOccurrence(liveSource);
      countDirectLookup?.('declaration.liveBindingHit');
      state.readonly ||= Boolean(liveHit.readonly || liveHit.cell.readonly || liveSource.options?.readonly);
      const visibility = scope.options.rulesVisibility?.VarDeclaration ?? '';
      if (visibility === 'optional' && !isRulesetBodyScope(scope)) {
        state.optionalMatch = liveOccurrence;
      } else {
        state.publicMatch = liveOccurrence;
        return state;
      }
    }
    if (
      frameHit.kind === 'declaration'
      && isNode(frameHit.sourceNode, N.VarDeclaration)
      && !frameHit.sourceNode.options?.setDefined
    ) {
      countDirectLookup?.('declaration.scopeBindingHit');
      state.readonly ||= Boolean(frameHit.readonly || frameHit.cell.readonly || frameHit.sourceNode.options.readonly);
      localMatch = createDeclarationOccurrence(frameHit.sourceNode);
      skipVarDeclarations = strategy.skipVarsAfterBindingHit;
    }
  }

  if (!skipVarDeclarations) {
    const treeMatch = findLocalDeclaration(
      scope,
      key,
      strategy,
      options,
      start,
      Boolean(localMatch && strategy.skipVarsAfterBindingHit)
    );
    localMatch = chooseTraversalMatch(localMatch, treeMatch);
  }

  if (localMatch) {
    countDirectLookup?.('declaration.localMatch');
    state.readonly ||= Boolean(localMatch.node.options.readonly);
    const visibility = getDeclarationVisibility(scope, strategy);
    if (visibility === 'optional' && !isRulesetBodyScope(scope)) {
      state.optionalMatch = chooseTraversalMatch(state.optionalMatch, localMatch);
      addCandidateMatch(options.optionalCandidates, localMatch);
    } else {
      state.publicMatch = chooseTraversalMatch(state.publicMatch, localMatch);
      addCandidateMatch(options.candidates, localMatch);
    }
  }

  const lexicalParentRules = includeLiveBindings
    ? scope._scopeFrame?.parent?.rulesNode
    : undefined;
  if (
    isNode(lexicalParentRules, N.Rules)
    && lexicalParentRules !== scope
  ) {
    const lexicalState = findWithinScopeSurface(
      lexicalParentRules as Rules,
      key,
      strategy,
      options,
      undefined,
      undefined,
      local,
      state.readonly,
      firstVisitedRules,
      secondVisitedRules,
      visited
    );
    mergeMatch(state, lexicalState, false);
  }

  const childEntries = scope.directDeclarationChildEntries !== undefined
    ? (scope.directDeclarationChildEntries ?? undefined)
    : scope.collectDirectDeclarationChildEntries();
  if (!childEntries?.length) {
    writeCachedMatch(scope, cacheKey, state);
    return state;
  }
  const scopeMayContainFamily = strategy.scopeMayContainFamily;
  const childEntryMayContainFamily = strategy.childEntryMayContainFamily;
  if (!scopeMayContainFamily(scope)) {
    countDirectLookup?.('declaration.childEntriesFamilySkip');
    writeCachedMatch(scope, cacheKey, state);
    return state;
  }

  countDirectLookup?.('declaration.childEntriesScanned');
  const lookupType = strategy.lookupVisibility;
  const context = options.context;
  for (let i = childEntries.length - 1; i >= 0; i--) {
    const entry = childEntries[i]!;
    if (!childEntryMayContainFamily(entry)) {
      countDirectLookup?.('declaration.childEntryFamilySkip');
      continue;
    }
    if (!canEnterRulesEntryForLookup(entry, {
      type: lookupType,
      hasTarget: options.hasTarget
    })) {
      countDirectLookup?.('declaration.childEntryRulesVisibilitySkip');
      continue;
    }
    if (!canEnterMixinOutputForLookup(entry, {
      type: lookupType,
      hasTarget: options.hasTarget
    })) {
      countDirectLookup?.('declaration.childEntryMixinOutputSkip');
      continue;
    }
    if (context?.rulesContext === scope && entry.node.options.forward) {
      countDirectLookup?.('declaration.childEntryForwardSkip');
      continue;
    }
    if (local && entry.node.options.local) {
      countDirectLookup?.('declaration.childEntryLocalSkip');
      continue;
    }
    if (childStart !== undefined && !((getContainingNodeStart(entry.node) ?? Infinity) < childStart)) {
      countDirectLookup?.('declaration.childEntryStartSkip');
      continue;
    }

    countDirectLookup?.('declaration.childEntryEntered');
    const childState = findWithinScopeSurface(
      entry.node,
      key,
      strategy,
      options,
      undefined,
      undefined,
      local || Boolean(entry.node.options.local),
      state.readonly || Boolean(entry.readonly),
      firstVisitedRules,
      secondVisitedRules,
      visited
    );
    const optionalOnly = isOptionalRulesEntry(entry, lookupType);
    mergeMatch(state, childState, optionalOnly);
    if (state.publicMatch && isPublicRulesEntry(entry, lookupType)) {
      break;
    }
  }

  writeCachedMatch(scope, cacheKey, state);
  return state;
}

function findDeclarationLookupWithStrategy(
  startRules: Rules,
  key: string,
  strategy: DeclarationLookupStrategy,
  options?: DirectDeclarationFindOptions,
  requireWritableSetDefined?: boolean
): DirectDeclarationOccurrence | undefined {
  const lookupOptions = options ?? EMPTY_DIRECT_DECLARATION_FIND_OPTIONS;
  const searchParents = lookupOptions.searchParents ?? true;
  const preserveLinearStart = lookupOptions.start !== undefined;
  let firstVisitedRules: Rules | undefined;
  let secondVisitedRules: Rules | undefined;
  let visitedParents: Set<Rules> | undefined;
  let ignoreCurrentScopeStart = lookupOptions.ignoreCurrentScopeStart === true;
  let start = lookupOptions.start;
  let rules: Rules | undefined = startRules;
  let searchingFallback = false;
  let optionalMatch = chooseCandidateMatch(undefined, lookupOptions.optionalCandidates, key, strategy, lookupOptions);
  let publicMatch = chooseCandidateMatch(undefined, lookupOptions.candidates, key, strategy, lookupOptions);
  let readonly = Boolean(lookupOptions.readonly);

  while (rules) {
    if (firstVisitedRules === rules || secondVisitedRules === rules || visitedParents?.has(rules)) {
      if (searchingFallback) {
        break;
      }
      throw new Error(searchingFallback
        ? 'Circular fallback frame chain detected in direct declaration lookup'
        : 'Circular parent chain detected in direct declaration lookup');
    }
    if (firstVisitedRules === undefined) {
      firstVisitedRules = rules;
    } else if (secondVisitedRules === undefined) {
      secondVisitedRules = rules;
    } else {
      visitedParents ??= new Set<Rules>([firstVisitedRules, secondVisitedRules]);
      visitedParents.add(rules);
    }

    const currentStart = searchingFallback || ignoreCurrentScopeStart ? undefined : start;
    const currentChildStart = searchingFallback ? undefined : start;
    ignoreCurrentScopeStart = false;
    const state = findWithinScopeSurface(
      rules,
      key,
      strategy,
      lookupOptions,
      currentStart,
      currentChildStart,
      Boolean(lookupOptions.local),
      readonly
    );
    readonly ||= state.readonly;
    publicMatch = chooseTraversalMatch(publicMatch, state.publicMatch);
    if (publicMatch) {
      return requireWritableSetDefined
        ? assertWritableSetDefinedOccurrence(publicMatch, readonly, key)
        : publicMatch;
    }
    optionalMatch = chooseTraversalMatch(optionalMatch, state.optionalMatch);
    if (searchingFallback) {
      const nextRulesNode: object | undefined = rules._scopeFrame?.fallbackFrame?.rulesNode;
      rules = nextRulesNode instanceof Rules ? nextRulesNode : undefined;
      continue;
    }
    if (!searchParents) {
      return undefined;
    }

    const parentStep = getDeclarationParentSearchStep(
      rules,
      start,
      preserveLinearStart,
      lookupOptions.ignoreParentScopeStart
    );
    rules = parentStep.rules;
    start = parentStep.start;
    if (!rules && strategy.includeFallbackFrames && optionalMatch === undefined) {
      const fallbackRulesNode = startRules._scopeFrame?.fallbackFrame?.rulesNode;
      rules = fallbackRulesNode instanceof Rules ? fallbackRulesNode : undefined;
      searchingFallback = true;
    }
  }

  return optionalMatch && requireWritableSetDefined
    ? assertWritableSetDefinedOccurrence(optionalMatch, readonly, key)
    : optionalMatch;
}

function assertWritableSetDefinedOccurrence(
  occurrence: DirectDeclarationOccurrence,
  inheritedReadonly: boolean,
  key: string
): DirectDeclarationOccurrence {
  if (occurrence.node.options?.readonly || inheritedReadonly) {
    throw new ReferenceError(`"${key}" is readonly`);
  }
  return occurrence;
}

export function findVariableDeclarationOccurrence(
  startRules: Rules,
  key: string,
  options?: DirectDeclarationFindOptions
): DirectDeclarationOccurrence | undefined;
export function findVariableDeclarationOccurrence(
  startRules: Rules,
  key: string,
  options?: DirectDeclarationFindOptions
): DirectDeclarationOccurrence | undefined {
  return findDeclarationLookupWithStrategy(startRules, key, VARIABLE_LOOKUP, options);
}

export function findPropertyDeclarationOccurrence(
  startRules: Rules,
  key: string,
  options?: DirectDeclarationFindOptions
): DirectDeclarationOccurrence | undefined;
export function findPropertyDeclarationOccurrence(
  startRules: Rules,
  key: string,
  options?: DirectDeclarationFindOptions
): DirectDeclarationOccurrence | undefined {
  return findDeclarationLookupWithStrategy(startRules, key, PROPERTY_LOOKUP, options);
}

export function findWritableSetDefinedDeclarationOccurrence(
  startRules: Rules,
  key: string,
  isVariable: boolean,
  options?: DirectDeclarationFindOptions
): DirectDeclarationOccurrence | undefined {
  const strategy = isVariable ? VARIABLE_OCCURRENCE_LOOKUP : PROPERTY_LOOKUP;
  return findDeclarationLookupWithStrategy(startRules, key, strategy, options, true);
}

export function findAnyDeclarationOccurrence(
  startRules: Rules,
  key: string,
  options?: DirectDeclarationFindOptions
): DirectDeclarationOccurrence | undefined {
  return findDeclarationLookupWithStrategy(startRules, key, ANY_DECLARATION_LOOKUP, options);
}
