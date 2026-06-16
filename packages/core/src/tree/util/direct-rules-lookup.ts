import type { Context } from '../../context.js';
import type { Declaration } from '../declaration.js';
import { Node } from '../node.js';
import { N } from '../node-type.js';
import type { Rules, RulesOptions } from '../rules.js';
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
  skipVarsAfterBindingHit: true
};

const PROPERTY_LOOKUP: DeclarationLookupStrategy = {
  cacheTag: 'p',
  lookupVisibility: 'Declaration',
  visibilityKey: 'Declaration',
  includeLiveBindings: false,
  includeFallbackFrames: false,
  prepareScopeFrame: false,
  acceptsNode: (node): node is Declaration => isNode(node, N.Declaration),
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
  skipVarsAfterBindingHit: false
};
const EMPTY_DIRECT_DECLARATION_FIND_OPTIONS: DirectDeclarationFindOptions = {};

export type DirectDeclarationOccurrence = {
  readonly kind: 'direct-declaration-occurrence';
  readonly node: Declaration;
  readonly ownerRules: Rules | undefined;
  readonly ownerLookupVersion: number | undefined;
  readonly index: number | undefined;
};

type DeclarationMatchState = {
  optionalMatch: DirectDeclarationOccurrence | undefined;
  publicMatch: DirectDeclarationOccurrence | undefined;
  readonly: boolean;
};

type CachedDeclarationMatchState = Readonly<DeclarationMatchState>;
export type DirectDeclarationLookupResult = {
  occurrence: DirectDeclarationOccurrence | undefined;
  readonly: boolean;
};
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
): RulesOptions['rulesVisibility'][string] | undefined {
  return strategy.visibilityKey === undefined
    ? undefined
    : rules.options.rulesVisibility?.[strategy.visibilityKey];
}

function childEntryMayContainLookupFamily(
  entry: { hasDeclarationSurface?: boolean; hasVarDeclarationSurface?: boolean },
  strategy: DeclarationLookupStrategy
): boolean {
  if (strategy.visibilityKey === 'VarDeclaration') {
    return entry.hasVarDeclarationSurface !== false;
  }
  if (strategy.visibilityKey === 'Declaration') {
    return entry.hasDeclarationSurface !== false;
  }
  return entry.hasDeclarationSurface !== false || entry.hasVarDeclarationSurface !== false;
}

function scopeMayContainChildLookupFamily(
  scope: Rules,
  strategy: DeclarationLookupStrategy
): boolean {
  if (strategy.visibilityKey === 'VarDeclaration') {
    return scope.hasVarDeclarationChildSurface;
  }
  if (strategy.visibilityKey === 'Declaration') {
    return scope.hasDeclarationChildSurface;
  }
  return scope.hasDeclarationChildSurface || scope.hasVarDeclarationChildSurface;
}

function passesDeclarationFilter(
  node: Node,
  key: string,
  strategy: DeclarationLookupStrategy,
  filter: DeclarationFindOptions['filter'] | undefined,
  start: number | undefined
): node is Declaration {
  if (!strategy.acceptsNode(node)) {
    return false;
  }
  if (node.options?.setDefined) {
    return false;
  }
  if (String(node.value.name.valueOf()) !== key) {
    return false;
  }
  if (start !== undefined && !(node.index !== undefined && node.index < start)) {
    return false;
  }
  return !filter || filter(node);
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
  const value = scope.value;
  for (let i = 0; i < value.length; i++) {
    const node = value[i]!;
    if (!isNode(node, N.Declaration | N.VarDeclaration)) {
      continue;
    }
    if (node.options?.setDefined) {
      continue;
    }
    if (String(node.value.name.valueOf()) === key) {
      bucket ??= [];
      bucket.push(node);
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
  return current;
}

function createDeclarationOccurrence(node: Declaration): DirectDeclarationOccurrence {
  const ownerRules = isNode(node.parent, N.Rules) ? node.parent : undefined;
  return {
    kind: 'direct-declaration-occurrence',
    node,
    ownerRules,
    ownerLookupVersion: ownerRules?.lookupVersion,
    index: node.index
  };
}

export function isDirectDeclarationOccurrenceCurrent(
  occurrence: DirectDeclarationOccurrence
): boolean {
  return (
    occurrence.node.parent === occurrence.ownerRules
    && occurrence.ownerRules?.lookupVersion === occurrence.ownerLookupVersion
    && occurrence.node.index === occurrence.index
  );
}

function chooseCandidateMatch(
  current: DirectDeclarationOccurrence | undefined,
  candidates: Set<Node> | undefined,
  key: string,
  strategy: DeclarationLookupStrategy,
  filter: DeclarationFindOptions['filter'] | undefined
): DirectDeclarationOccurrence | undefined {
  if (!candidates?.size) {
    return current;
  }
  let out = current;
  for (const candidate of candidates) {
    if (passesDeclarationFilter(candidate, key, strategy, filter, undefined)) {
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
      start = containingNode?.index ?? start;
    }
  } while (cursor && !isNode(cursor, N.Rules));

  return { rules: isNode(cursor, N.Rules) ? cursor : undefined, start };
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
  filter: DeclarationFindOptions['filter'] | undefined,
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
    if (passesDeclarationFilter(node, key, strategy, filter, start)) {
      return createDeclarationOccurrence(node);
    }
  }
  return undefined;
}

function findScopeBindingDeclaration(
  scope: Rules,
  key: string,
  filter: DeclarationFindOptions['filter'] | undefined,
  start: number | undefined
): DirectDeclarationOccurrence | undefined {
  const frame = scope._scopeFrame;
  if (!frame?.declarationsCovered) {
    return undefined;
  }
  const bucket = frame.declarationBucketsByName.get(key);
  if (!bucket?.length) {
    return undefined;
  }
  for (let i = bucket.length - 1; i >= 0; i--) {
    const sourceNode = bucket[i]!.sourceNode;
    if (!isNode(sourceNode, N.VarDeclaration)) {
      continue;
    }
    if (sourceNode.options?.setDefined) {
      continue;
    }
    if (start !== undefined && !(sourceNode.index !== undefined && sourceNode.index < start)) {
      continue;
    }
    if (!filter || filter(sourceNode)) {
      return createDeclarationOccurrence(sourceNode);
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
  if (includeLiveBindings) {
    const live = scope._scopeFrame?.currentBindingsByName.get(key);
    const liveSource = live?.live === true
      ? live.sourceNode
      : undefined;
    if (
      liveSource
      && isNode(liveSource, N.VarDeclaration)
      && (!options.filter || options.filter(liveSource))
    ) {
      const liveOccurrence = createDeclarationOccurrence(liveSource);
      countDirectLookup?.('declaration.liveBindingHit');
      state.readonly ||= Boolean(live.readonly || liveSource.options?.readonly);
      const visibility = scope.options.rulesVisibility?.VarDeclaration ?? '';
      if (visibility === 'optional' && !isRulesetBodyScope(scope)) {
        state.optionalMatch = liveOccurrence;
      } else {
        state.publicMatch = liveOccurrence;
        return state;
      }
    }
  }

  let localMatch: DirectDeclarationOccurrence | undefined;
  if (includeLiveBindings) {
    const bindingMatch = findScopeBindingDeclaration(scope, key, options.filter, start);
    if (bindingMatch) {
      countDirectLookup?.('declaration.scopeBindingHit');
      state.readonly ||= Boolean(bindingMatch.node.options.readonly);
      localMatch = bindingMatch;
    }
  }

  const skipVarDeclarations = Boolean(localMatch && strategy.skipVarsAfterBindingHit);
  if (!skipVarDeclarations) {
    const treeMatch = findLocalDeclaration(
      scope,
      key,
      strategy,
      options.filter,
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
  if (!scopeMayContainChildLookupFamily(scope, strategy)) {
    countDirectLookup?.('declaration.childEntriesFamilySkip');
    writeCachedMatch(scope, cacheKey, state);
    return state;
  }

  countDirectLookup?.('declaration.childEntriesScanned');
  const lookupType = strategy.lookupVisibility;
  const context = options.context;
  for (let i = childEntries.length - 1; i >= 0; i--) {
    const entry = childEntries[i]!;
    if (!childEntryMayContainLookupFamily(entry, strategy)) {
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
    if (childStart !== undefined && !(entry.node.index !== undefined && entry.node.index < childStart)) {
      countDirectLookup?.('declaration.childEntryStartSkip');
      continue;
    }

    countDirectLookup?.('declaration.childEntryEntered');
    const childState = findWithinScopeSurface(
      entry.node,
      key,
      strategy,
      options,
      start,
      childStart,
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
  options?: DirectDeclarationFindOptions
): DirectDeclarationLookupResult {
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
  let optionalMatch = chooseCandidateMatch(undefined, lookupOptions.optionalCandidates, key, strategy, lookupOptions.filter);
  let publicMatch = chooseCandidateMatch(undefined, lookupOptions.candidates, key, strategy, lookupOptions.filter);
  let readonly = Boolean(lookupOptions.readonly);

  while (rules) {
    if (firstVisitedRules === rules || secondVisitedRules === rules || visitedParents?.has(rules)) {
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
      return { occurrence: publicMatch, readonly };
    }
    optionalMatch = chooseTraversalMatch(optionalMatch, state.optionalMatch);
    if (searchingFallback) {
      rules = rules._scopeFrame?.fallbackFrame?.rulesNode
        ?? (isNode(rules.parent, N.Rules) ? rules.parent : undefined);
      continue;
    }
    if (!searchParents) {
      return { occurrence: undefined, readonly };
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
      rules = startRules._scopeFrame?.fallbackFrame?.rulesNode;
      searchingFallback = true;
    }
  }

  return { occurrence: optionalMatch, readonly };
}

function findDeclarationOccurrenceWithStrategy(
  startRules: Rules,
  key: string,
  strategy: DeclarationLookupStrategy,
  options?: DirectDeclarationFindOptions
): DirectDeclarationOccurrence | undefined {
  return findDeclarationLookupWithStrategy(startRules, key, strategy, options).occurrence;
}

export function findVariableDeclarationLookup(
  startRules: Rules,
  key: string,
  options?: DirectDeclarationFindOptions
): DirectDeclarationLookupResult {
  const found = findDeclarationLookupWithStrategy(startRules, key, VARIABLE_LOOKUP, options);
  return isNode(found.occurrence?.node, N.VarDeclaration)
    ? found
    : { occurrence: undefined, readonly: found.readonly };
}

export function findPropertyDeclarationLookup(
  startRules: Rules,
  key: string,
  options?: DirectDeclarationFindOptions
): DirectDeclarationLookupResult {
  const found = findDeclarationLookupWithStrategy(startRules, key, PROPERTY_LOOKUP, options);
  return isNode(found.occurrence?.node, N.Declaration)
    ? found
    : { occurrence: undefined, readonly: found.readonly };
}

export function findVariableDeclarationOccurrence(
  startRules: Rules,
  key: string,
  options?: DirectDeclarationFindOptions
): DirectDeclarationOccurrence | undefined {
  return findVariableDeclarationLookup(startRules, key, options).occurrence;
}

export function findPropertyDeclarationOccurrence(
  startRules: Rules,
  key: string,
  options?: DirectDeclarationFindOptions
): DirectDeclarationOccurrence | undefined {
  return findPropertyDeclarationLookup(startRules, key, options).occurrence;
}

export function findAnyDeclarationOccurrence(
  startRules: Rules,
  key: string,
  options?: DirectDeclarationFindOptions
): DirectDeclarationOccurrence | undefined {
  return findDeclarationOccurrenceWithStrategy(startRules, key, ANY_DECLARATION_LOOKUP, options);
}
