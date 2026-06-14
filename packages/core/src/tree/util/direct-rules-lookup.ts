import type { Context } from '../../context.js';
import type { Declaration } from '../declaration.js';
import type { VarDeclaration } from '../declaration-var.js';
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

type DirectDeclarationLookupResult = Declaration | undefined;
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

type MatchState = {
  optionalMatch: Declaration | undefined;
  publicMatch: Declaration | undefined;
  readonly: boolean;
};

type CachedMatch = MatchState;

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
  current: Declaration | undefined,
  next: Declaration | undefined
): Declaration | undefined {
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  if (
    current.parent === next.parent
    && typeof current.index === 'number'
    && typeof next.index === 'number'
  ) {
    return current.index < next.index ? next : current;
  }
  return current;
}

function chooseCandidateMatch(
  current: Declaration | undefined,
  candidates: Set<Node> | undefined,
  key: string,
  strategy: DeclarationLookupStrategy,
  filter: DeclarationFindOptions['filter'] | undefined
): Declaration | undefined {
  if (!candidates?.size) {
    return current;
  }
  let out = current;
  for (const candidate of candidates) {
    if (passesDeclarationFilter(candidate, key, strategy, filter, undefined)) {
      out = chooseTraversalMatch(out, candidate);
    }
  }
  return out;
}

function addCandidateMatch(
  candidates: Set<Node> | undefined,
  match: Declaration | undefined
): void {
  if (candidates && match) {
    candidates.add(match);
  }
}

function createEmptyState(readonly = false): MatchState {
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
  target: MatchState,
  source: MatchState,
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
    || options.candidates
    || options.optionalCandidates
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

function readCachedMatch(scope: Rules, cacheKey: string | undefined): CachedMatch | undefined {
  if (!cacheKey) {
    return undefined;
  }
  const cached = scope.directDeclarationLookupCache?.get(cacheKey);
  if (!cached) {
    return undefined;
  }
  return cached;
}

function writeCachedMatch(scope: Rules, cacheKey: string | undefined, state: MatchState): void {
  if (!cacheKey) {
    return;
  }
  const cached = createEmptyState(state.readonly);
  cached.optionalMatch = state.optionalMatch;
  cached.publicMatch = state.publicMatch;
  (scope.directDeclarationLookupCache ??= new Map()).set(cacheKey, cached);
}

function findLocalDeclaration(
  scope: Rules,
  key: string,
  strategy: DeclarationLookupStrategy,
  filter: DeclarationFindOptions['filter'] | undefined,
  start: number | undefined,
  skipVarDeclarations = false
): Declaration | undefined {
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
      return node;
    }
  }
  return undefined;
}

function findScopeBindingDeclaration(
  scope: Rules,
  key: string,
  filter: DeclarationFindOptions['filter'] | undefined,
  start: number | undefined
): Declaration | undefined {
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
      return sourceNode;
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
  visited?: Set<Rules>
): MatchState {
  if (visited?.has(scope)) {
    return createEmptyState(readonly);
  }
  const cacheKey = getRecursiveLookupCacheKey(key, strategy, options, start, local, readonly);
  const cached = readCachedMatch(scope, cacheKey);
  if (cached) {
    return cached;
  }

  const includeLiveBindings = strategy.includeLiveBindings && options.includeLiveBindings !== false;
  if (strategy.prepareScopeFrame && includeLiveBindings) {
    if (!scope._scopeFrame) {
      if (scope.rulesIndexed < scope.value.length) {
        scope._indexRules();
      }
      scope.getScopeFrame();
    }
  }

  const state = createEmptyState(readonly || Boolean(scope.options.readonly));
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
      state.readonly ||= Boolean(live.readonly || liveSource.options?.readonly);
      const visibility = scope.options.rulesVisibility?.VarDeclaration ?? '';
      if (visibility === 'optional' && !isRulesetBodyScope(scope)) {
        state.optionalMatch = liveSource;
      } else {
        state.publicMatch = liveSource;
        return state;
      }
    }
  }

  let localMatch: Declaration | undefined;
  if (includeLiveBindings) {
    const bindingMatch = findScopeBindingDeclaration(scope, key, options.filter, start);
    if (bindingMatch) {
      state.readonly ||= Boolean(bindingMatch.options.readonly);
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
    state.readonly ||= Boolean(localMatch.options.readonly);
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
    visited ??= new Set<Rules>();
    visited.add(scope);
    const lexicalState = findWithinScopeSurface(
      lexicalParentRules as Rules,
      key,
      strategy,
      options,
      undefined,
      undefined,
      local,
      state.readonly,
      visited
    );
    mergeMatch(state, lexicalState, false);
  }

  if (
    scope.directDeclarationChildEntries === undefined
    && scope.rulesIndexed >= scope.value.length
    && !scope.hasDirectChildRuleSurface
  ) {
    writeCachedMatch(scope, cacheKey, state);
    return state;
  }
  const childEntries = scope.directDeclarationChildEntries !== undefined
    ? (scope.directDeclarationChildEntries ?? undefined)
    : scope.collectDirectDeclarationChildEntries();
  if (!childEntries?.length) {
    writeCachedMatch(scope, cacheKey, state);
    return state;
  }

  const lookupType = strategy.lookupVisibility;
  const context = options.context;
  visited ??= new Set<Rules>();
  visited.add(scope);
  for (let i = childEntries.length - 1; i >= 0; i--) {
    const entry = childEntries[i]!;
    if (!canEnterRulesEntryForLookup(entry, {
      type: lookupType,
      hasTarget: options.hasTarget
    })) {
      continue;
    }
    if (!canEnterMixinOutputForLookup(entry, {
      type: lookupType,
      hasTarget: options.hasTarget
    })) {
      continue;
    }
    if (context?.rulesContext === scope && entry.node.options.forward) {
      continue;
    }
    if (local && entry.node.options.local) {
      continue;
    }
    if (childStart !== undefined && !(entry.node.index !== undefined && entry.node.index < childStart)) {
      continue;
    }

    const childState = findWithinScopeSurface(
      entry.node,
      key,
      strategy,
      options,
      start,
      childStart,
      local || Boolean(entry.node.options.local),
      state.readonly || Boolean(entry.readonly),
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

function findDeclarationWithStrategy(
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
      if (readonly && options) {
        options.readonly = true;
      }
      return publicMatch;
    }
    optionalMatch = chooseTraversalMatch(optionalMatch, state.optionalMatch);
    if (searchingFallback) {
      rules = rules._scopeFrame?.fallbackFrame?.rulesNode
        ?? (isNode(rules.parent, N.Rules) ? rules.parent : undefined);
      continue;
    }
    if (!searchParents) {
      if (readonly && options) {
        options.readonly = true;
      }
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
      rules = startRules._scopeFrame?.fallbackFrame?.rulesNode;
      searchingFallback = true;
    }
  }

  if (readonly && options) {
    options.readonly = true;
  }
  return optionalMatch;
}

export function findVariableDeclaration(
  startRules: Rules,
  key: string,
  options?: DirectDeclarationFindOptions
): VarDeclaration | undefined {
  const found = findDeclarationWithStrategy(startRules, key, VARIABLE_LOOKUP, options);
  return isNode(found, N.VarDeclaration) ? found : undefined;
}

export function findPropertyDeclaration(
  startRules: Rules,
  key: string,
  options?: DirectDeclarationFindOptions
): Declaration | undefined {
  const found = findDeclarationWithStrategy(startRules, key, PROPERTY_LOOKUP, options);
  return isNode(found, N.Declaration) ? found : undefined;
}

export function findAnyDeclaration(
  startRules: Rules,
  key: string,
  options?: DirectDeclarationFindOptions
): DirectDeclarationLookupResult {
  return findDeclarationWithStrategy(startRules, key, ANY_DECLARATION_LOOKUP, options);
}
