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
import type { DeclarationFindOptions } from './registry-utils.js';

type DirectDeclarationLookupResult = Declaration | undefined | typeof DIRECT_DECLARATION_LOOKUP_UNCOVERED;
type DirectDeclarationFindOptions = DeclarationFindOptions & {
  context?: Context;
};

export const DIRECT_DECLARATION_LOOKUP_UNCOVERED = Symbol('direct-declaration-lookup-uncovered');

type DeclarationLookupStrategy = {
  cacheTag: string;
  lookupVisibility: LookupVisibility;
  visibilityKey: 'VarDeclaration' | 'Declaration' | undefined;
  includeLiveBindings: boolean;
  includeFallbackFrames: boolean;
  prepareScopeFrame: boolean;
  semanticFilterCovered: boolean;
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
  semanticFilterCovered: true,
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
  semanticFilterCovered: false,
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
  semanticFilterCovered: false,
  acceptsNode: (node): node is Declaration => isNode(node, N.Declaration | N.VarDeclaration),
  skipVarsAfterBindingHit: false
};
const EMPTY_DIRECT_DECLARATION_FIND_OPTIONS: DirectDeclarationFindOptions = {};

type MatchState = {
  optionalMatch: Declaration | undefined;
  publicMatch: Declaration | undefined;
  readonly: boolean;
};

type CachedMatch = {
  optionalMatch: Declaration | undefined;
  publicMatch: Declaration | undefined;
  readonly: boolean;
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
  let buckets = scope.directDeclarationsByName;
  if (!buckets) {
    buckets = new Map<string, Declaration[]>();
    const value = scope.value;
    for (let i = 0; i < value.length; i++) {
      const node = value[i]!;
      if (!isNode(node, N.Declaration | N.VarDeclaration)) {
        continue;
      }
      if (node.options?.setDefined) {
        continue;
      }
      const name = String(node.value.name.valueOf());
      let bucket = buckets.get(name);
      if (!bucket) {
        buckets.set(name, bucket = []);
      }
      bucket.push(node);
    }
    scope.directDeclarationsByName = buckets;
  }
  return buckets.get(key);
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
      start = containingNode?.index;
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
    || options.findAll
    || options.candidates
    || options.optionalCandidates
    || options.searchedRules
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
  return {
    publicMatch: cached.publicMatch,
    optionalMatch: cached.optionalMatch,
    readonly: cached.readonly
  };
}

function writeCachedMatch(scope: Rules, cacheKey: string | undefined, state: MatchState): void {
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
  visited: Set<Rules>
): MatchState {
  if (visited.has(scope)) {
    return createEmptyState(readonly);
  }
  const cacheKey = getRecursiveLookupCacheKey(key, strategy, options, start, local, readonly);
  const cached = readCachedMatch(scope, cacheKey);
  if (cached) {
    return cached;
  }
  visited.add(scope);

  if (strategy.prepareScopeFrame) {
    if (!scope._scopeFrame) {
      if (scope.rulesIndexed < scope.value.length) {
        scope._indexRules();
      }
      scope.getScopeFrame();
    }
  }

  const state = createEmptyState(readonly || Boolean(scope.options.readonly));
  if (strategy.includeLiveBindings) {
    const live = scope._scopeFrame?.currentBindingsByName.get(key);
    const liveSource = live?.kind === 'live' ? live.sourceNode : undefined;
    if (
      liveSource
      && isNode(liveSource, N.VarDeclaration)
      && (!options.filter || options.filter(liveSource))
    ) {
      state.readonly ||= Boolean(live.cell.readonly || liveSource.options?.readonly);
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
  if (strategy.includeLiveBindings) {
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
    } else {
      state.publicMatch = chooseTraversalMatch(state.publicMatch, localMatch);
    }
  }

  const lexicalParentRules = strategy.includeLiveBindings
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

  const lookupType = strategy.lookupVisibility;
  const context = options.context;
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
  if (
    lookupOptions.findAll
    || (lookupOptions.candidates !== undefined && lookupOptions.candidates.size > 0)
    || (lookupOptions.optionalCandidates !== undefined && lookupOptions.optionalCandidates.size > 0)
    || (!strategy.semanticFilterCovered && lookupOptions.semanticFilter)
  ) {
    return DIRECT_DECLARATION_LOOKUP_UNCOVERED;
  }

  const searchParents = lookupOptions.searchParents ?? true;
  const preserveLinearStart = lookupOptions.start !== undefined;
  const visitedParents = new Set<Rules>();
  let ignoreCurrentScopeStart = lookupOptions.ignoreCurrentScopeStart === true;
  let start = lookupOptions.start;
  let rules: Rules | undefined = startRules;
  let optionalMatch: Declaration | undefined;
  let readonly = Boolean(lookupOptions.readonly);

  while (rules) {
    if (visitedParents.has(rules)) {
      throw new Error('Circular parent chain detected in direct declaration lookup');
    }
    visitedParents.add(rules);

    const currentStart = ignoreCurrentScopeStart ? undefined : start;
    const currentChildStart = start;
    ignoreCurrentScopeStart = false;
    const state = findWithinScopeSurface(
      rules,
      key,
      strategy,
      lookupOptions,
      currentStart,
      currentChildStart,
      Boolean(lookupOptions.local),
      readonly,
      new Set<Rules>()
    );
    readonly ||= state.readonly;
    if (state.publicMatch) {
      if (readonly && options) {
        options.readonly = true;
      }
      return state.publicMatch;
    }
    optionalMatch = chooseTraversalMatch(optionalMatch, state.optionalMatch);
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
  }

  let fallbackRules = strategy.includeFallbackFrames
    && optionalMatch === undefined
    ? startRules._scopeFrame?.fallbackFrame?.rulesNode
    : undefined;
  while (fallbackRules) {
    if (visitedParents.has(fallbackRules)) {
      throw new Error('Circular fallback frame chain detected in direct declaration lookup');
    }
    visitedParents.add(fallbackRules);
    const state = findWithinScopeSurface(
      fallbackRules,
      key,
      strategy,
      lookupOptions,
      undefined,
      undefined,
      Boolean(lookupOptions.local),
      readonly,
      new Set<Rules>()
    );
    readonly ||= state.readonly;
    if (state.publicMatch) {
      if (readonly && options) {
        options.readonly = true;
      }
      return state.publicMatch;
    }
    optionalMatch = chooseTraversalMatch(optionalMatch, state.optionalMatch);
    fallbackRules = fallbackRules._scopeFrame?.fallbackFrame?.rulesNode
      ?? (isNode(fallbackRules.parent, N.Rules) ? fallbackRules.parent : undefined);
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
): VarDeclaration | undefined | typeof DIRECT_DECLARATION_LOOKUP_UNCOVERED {
  const found = findDeclarationWithStrategy(startRules, key, VARIABLE_LOOKUP, options);
  return found === DIRECT_DECLARATION_LOOKUP_UNCOVERED || isNode(found, N.VarDeclaration)
    ? found
    : undefined;
}

export function findPropertyDeclaration(
  startRules: Rules,
  key: string,
  options?: DirectDeclarationFindOptions
): Declaration | undefined | typeof DIRECT_DECLARATION_LOOKUP_UNCOVERED {
  const found = findDeclarationWithStrategy(startRules, key, PROPERTY_LOOKUP, options);
  return found === DIRECT_DECLARATION_LOOKUP_UNCOVERED || isNode(found, N.Declaration)
    ? found
    : undefined;
}

export function findAnyDeclaration(
  startRules: Rules,
  key: string,
  options?: DirectDeclarationFindOptions
): DirectDeclarationLookupResult {
  return findDeclarationWithStrategy(startRules, key, ANY_DECLARATION_LOOKUP, options);
}
