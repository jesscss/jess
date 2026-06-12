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
  type LookupVisibility,
  type RulesEntryLike
} from './mixin-output-slot.js';
import type { DeclarationFindOptions } from './registry-utils.js';

type DeclarationFilterType = 'VarDeclaration' | 'Declaration' | undefined;
type DirectDeclarationLookupResult = Declaration | undefined | typeof DIRECT_DECLARATION_LOOKUP_UNCOVERED;
type DirectDeclarationFindOptions = DeclarationFindOptions & {
  context?: Context;
};

export const DIRECT_DECLARATION_LOOKUP_UNCOVERED = Symbol('direct-declaration-lookup-uncovered');

type RulesEntry = RulesEntryLike & {
  readonly?: boolean;
};

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

function getDeclarationLookupVisibility(type: DeclarationFilterType): LookupVisibility {
  return type ?? 'Declaration';
}

function getDeclarationVisibility(
  rules: Rules,
  filterType: DeclarationFilterType
): RulesOptions['rulesVisibility'][string] | undefined {
  return filterType
    ? rules.options.rulesVisibility?.[filterType]
    : undefined;
}

function passesDeclarationFilter(
  node: Node,
  key: string,
  filterType: DeclarationFilterType,
  filter: DeclarationFindOptions['filter'] | undefined,
  start: number | undefined
): node is Declaration {
  if (!isNode(node, N.Declaration | N.VarDeclaration)) {
    return false;
  }
  if (filterType && node.type !== filterType) {
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
  filterType: DeclarationFilterType,
  options: DirectDeclarationFindOptions,
  start: number | undefined,
  local: boolean,
  readonly: boolean
): string | undefined {
  if (
    start !== undefined
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
    filterType ?? '',
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

function childRulesOf(node: Node): Rules | undefined {
  if (isNode(node, N.Rules)) {
    return node;
  }
  if (isNode(node, N.Ruleset) || isNode(node, N.Mixin)) {
    return node.value.rules;
  }
  if (isNode(node, N.AtRule)) {
    return node.value.rules;
  }
  return undefined;
}

function defaultRulesVisibility(rules: Rules): RulesOptions['rulesVisibility'] {
  const visibility: RulesOptions['rulesVisibility'] = {
    ...rules.options.rulesVisibility
  };
  visibility.Declaration ??= 'public';
  visibility.Ruleset ??= 'public';
  visibility.Mixin ??= 'public';
  return visibility;
}

function collectDirectChildEntries(scope: Rules): RulesEntry[] | undefined {
  let out: RulesEntry[] | undefined;
  const value = scope.value;
  for (let i = 0; i < value.length; i++) {
    const childRules = childRulesOf(value[i]!);
    if (!childRules) {
      continue;
    }
    (out ??= []).push({
      node: childRules,
      readonly: childRules.options.readonly,
      rulesVisibility: defaultRulesVisibility(childRules)
    });
  }
  return out;
}

function findLocalDeclaration(
  scope: Rules,
  key: string,
  filterType: DeclarationFilterType,
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
    if (passesDeclarationFilter(node, key, filterType, filter, start)) {
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
  filterType: DeclarationFilterType,
  options: DirectDeclarationFindOptions,
  start: number | undefined,
  local: boolean,
  readonly: boolean,
  visited: Set<Rules>
): MatchState {
  if (visited.has(scope)) {
    return createEmptyState(readonly);
  }
  const cacheKey = getRecursiveLookupCacheKey(key, filterType, options, start, local, readonly);
  const cached = readCachedMatch(scope, cacheKey);
  if (cached) {
    return cached;
  }
  visited.add(scope);

  const state = createEmptyState(readonly || Boolean(scope.options.readonly));
  if (filterType !== 'Declaration') {
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
  if (filterType !== 'Declaration') {
    const bindingMatch = findScopeBindingDeclaration(scope, key, options.filter, start);
    if (bindingMatch) {
      state.readonly ||= Boolean(bindingMatch.options.readonly);
      localMatch = bindingMatch;
    }
  }

  const skipVarDeclarations = Boolean(localMatch && filterType === 'VarDeclaration');
  if (!skipVarDeclarations) {
    const treeMatch = findLocalDeclaration(
      scope,
      key,
      filterType,
      options.filter,
      start,
      Boolean(localMatch && filterType === undefined)
    );
    localMatch = chooseTraversalMatch(localMatch, treeMatch);
  }

  if (localMatch) {
    state.readonly ||= Boolean(localMatch.options.readonly);
    const visibility = getDeclarationVisibility(scope, filterType);
    if (visibility === 'optional' && !isRulesetBodyScope(scope)) {
      state.optionalMatch = chooseTraversalMatch(state.optionalMatch, localMatch);
    } else {
      state.publicMatch = chooseTraversalMatch(state.publicMatch, localMatch);
    }
  }

  const childEntries = collectDirectChildEntries(scope);
  if (!childEntries?.length) {
    writeCachedMatch(scope, cacheKey, state);
    return state;
  }

  const lookupType = getDeclarationLookupVisibility(filterType);
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
    if (start !== undefined && !(entry.node.index !== undefined && entry.node.index < start)) {
      continue;
    }

    const childState = findWithinScopeSurface(
      entry.node,
      key,
      filterType,
      options,
      start,
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

export function findDeclarationDirect(
  startRules: Rules,
  key: string,
  filterType: DeclarationFilterType,
  options: DirectDeclarationFindOptions = {}
): DirectDeclarationLookupResult {
  if (
    options.findAll
    || options.candidates
    || options.optionalCandidates
    || options.searchedRules
    || (filterType !== 'VarDeclaration' && options.semanticFilter)
  ) {
    return DIRECT_DECLARATION_LOOKUP_UNCOVERED;
  }

  const searchParents = options.searchParents ?? true;
  const preserveLinearStart = options.start !== undefined;
  const visitedParents = new Set<Rules>();
  let ignoreCurrentScopeStart = options.ignoreCurrentScopeStart === true;
  let start = options.start;
  let rules: Rules | undefined = startRules;
  let optionalMatch: Declaration | undefined;
  let readonly = Boolean(options.readonly);

  while (rules) {
    if (visitedParents.has(rules)) {
      throw new Error('Circular parent chain detected in findDeclarationDirect');
    }
    visitedParents.add(rules);

    const currentStart = ignoreCurrentScopeStart ? undefined : start;
    ignoreCurrentScopeStart = false;
    const state = findWithinScopeSurface(
      rules,
      key,
      filterType,
      options,
      currentStart,
      Boolean(options.local),
      readonly,
      new Set<Rules>()
    );
    readonly ||= state.readonly;
    if (state.publicMatch) {
      if (readonly) {
        options.readonly = true;
      }
      return state.publicMatch;
    }
    optionalMatch = chooseTraversalMatch(optionalMatch, state.optionalMatch);
    if (!searchParents) {
      if (readonly) {
        options.readonly = true;
      }
      return undefined;
    }

    const parentStep = getDeclarationParentSearchStep(
      rules,
      start,
      preserveLinearStart,
      options.ignoreParentScopeStart
    );
    rules = parentStep.rules;
    start = parentStep.start;
  }

  if (readonly) {
    options.readonly = true;
  }
  return optionalMatch;
}
