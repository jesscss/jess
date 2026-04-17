import { defineType, Node, F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC, F_STATIC, type LocationInfo } from './node.js';
import type { Context, TreeContext } from '../context.js';
import { cast } from './util/cast.js';
import type { FindOptions } from './util/registry-utils.js';
import { Any, type AnyRole } from './any.js';
import { Selector } from './selector.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import type { Call } from './call.js';
import type { Quoted } from './quoted.js';
import { atIndex } from './util/collections.js';
import type { Num } from './number.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { isThenable, type MaybePromise, pipe } from '@jesscss/awaitable-pipe';
import { MixinCollection } from './rules.js';
import type { Rules, RuntimeVarBinding, MixinEntry } from './rules.js';
import type { Interpolated } from './interpolated.js';
import { freezeChildren } from './util/cloning.js';
import type { Declaration } from './declaration.js';
import type { Color } from './color.js';
import { List } from './list.js';
import { Nil } from './nil.js';
import { comparePosition } from './util/compare.js';
import type { BindingEntry, ScopeFrame } from './scope-frame.js';
import type { VarDeclaration } from './declaration-var.js';
import { getOrderedSelectorKeys, isNonClassicImportBoundary } from './util/registry-utils.js';
/**
 * The type is determined by syntax
 * and location.
 *   e.g. in Jess
 *    - `$foo` refers to a variable
 *    - `$.foo` is a prop or var
 *    - `$foo$(bar)` is a var var
 *    - `$foo.bar` is a prop or var `bar` in `foo`
 *    - in `$|.foo()`, `.foo` is a mixin
 *    - in `$foo|.mixin()`, `.mixin` is a mixin in `$foo`
 *    - Resolution:
 *      - `$` searches scope,
 *      - `$^` searches in declaration order
 *   in Less
 *   - `@foo` refers to a variable
 *   - `$foo` refers to a property
 *   - `.foo` or `#foo` refers to a mixin
 */
export type ReferenceValue = {
  target?: Reference | Call | undefined;
  rawKey?:
    string
    | string[]
    | Node
    | Any
    | number
    | Num
    | Quoted
    | Selector
    | Reference
    | Interpolated;
  key:
    string
    | string[]
    | Node
    | Any
    | number // $[0] or $.0
    | Num // $.key or $[key] or $*key
    | Quoted // $['key']
    | Selector // $*(.selector)
    | Reference // $.key
    | Interpolated; // @{variable} interpolation
};

export type ReferenceOptions = {
  /**
   * What kind of lookup are we doing?
   */
  type?: 'index' | 'declaration' | 'property' | 'variable' | 'function' | 'mixin' | 'mixin-ruleset';
  /**
   * Resolution strategy:
   * - 'contextual': Contextual lookup (default)
   * - 'live': Resolve using call-site/live lookup semantics
   */
  resolution?: 'contextual' | 'live';
  /**
   * Optional references just resolve to the string
   * representation if the fallback value is set to true.
   *
   * @note - Used by Less for function references
   */
  fallbackValue?: Node | true;
  filter?: (node: Node) => boolean;
  role?: AnyRole;
};

const isRuntimeVarBinding = (value: unknown): value is RuntimeVarBinding => (
  value !== null
  && typeof value === 'object'
  && 'kind' in value
  && value.kind === 'runtime-var-binding'
);

/**
 * Fast parent-chain walk for ordinary VarDeclaration lookup.
 *
 * Bypasses the full declaration-registry machinery (Set creation, indexPendingItems,
 * Set→Array conversion, sort, _searchRulesChildren) for the dominant hot case:
 * lexical variables looked up from nested scopes.
 *
 * Invariant: `varsByName === undefined` means the scope has not yet been indexed
 * by `_indexRules`. `varsByName` is initialized to an empty Map at the start of
 * `_indexRules` so that "indexed with no vars" is distinguishable from "not indexed".
 *
 * When `varsByName` is undefined the fast path bails immediately (returns undefined),
 * causing the caller to fall back to the full declaration registry which will trigger
 * indexing and warm up `varsByName` for all visited scopes. Subsequent lookups then
 * use the fast path for the entire chain.
 *
 * Last entry in varsByName wins (Less "last definition wins" / contextual semantics).
 */
function findVarDeclarationFast(
  startRules: Rules,
  name: string,
  filter: (n: Node) => boolean,
  options: {
    start?: number;
    context: Context;
    hasTarget?: boolean;
    local?: boolean;
  }
): {
  match: Node | undefined;
} {
  const selectBucketCandidate = (
    bucket: BindingEntry[] | undefined,
    start: number | undefined
  ): Node | undefined => {
    if (!bucket?.length) {
      return undefined;
    }
    for (let i = bucket.length - 1; i >= 0; i--) {
      const candidate = bucket[i]!;
      if (start !== undefined && !(candidate.sourceNode.index !== undefined && candidate.sourceNode.index < start)) {
        continue;
      }
      if (filter(candidate.sourceNode)) {
        return candidate.sourceNode;
      }
    }
    return undefined;
  };

  const laterOf = <T extends Node>(a: T | undefined, b: T | undefined): T | undefined => {
    if (!a) {
      return b;
    }
    if (!b) {
      return a;
    }
    if (!a.parent && b.parent) {
      return b;
    }
    if (a.parent && !b.parent) {
      return a;
    }
    let position: ReturnType<typeof comparePosition>;
    try {
      position = comparePosition(a, b);
    } catch {
      return a.parent || !b.parent ? a : b;
    }
    return position !== undefined && position <= 0 ? b : a;
  };

  const promoteResolvedPendingDecls = (
    scope: Rules,
    frame: ScopeFrame
  ): void => {
    if (frame.pendingDynamicDecls.length === 0) {
      return;
    }
    const remaining: VarDeclaration[] = [];
    let mutated = false;

    for (const decl of frame.pendingDynamicDecls) {
      if (decl.parent !== scope) {
        remaining.push(decl);
        continue;
      }

      const declName = decl.value.name;
      const isStaticName = !(declName instanceof Node) || declName.hasFlag(F_STATIC);
      if (!isStaticName) {
        remaining.push(decl);
        continue;
      }

      const resolvedName = `${declName.valueOf()}`;
      const sourceIdentity = decl.sourceNode ?? decl;
      let bucket = frame.declarationBucketsByName.get(resolvedName);
      if (!bucket) {
        frame.declarationBucketsByName.set(resolvedName, bucket = []);
      }
      if (!bucket.some((entry) => {
        const entryIdentity = entry.sourceNode.sourceNode ?? entry.sourceNode;
        return entry.sourceNode === decl
          || entry.sourceNode === sourceIdentity
          || entryIdentity === sourceIdentity;
      })) {
        bucket.push({
          cell: {
            value: decl.value.value,
            sourceNode: decl,
            readonly: decl.options?.readonly
          },
          sourceNode: decl
        });
      }
      mutated = true;
    }

    if (mutated) {
      frame.pendingDynamicDecls = remaining;
    }
  };

  const findVarWithinScopeSurface = (
    scope: Rules,
    scopeStart: number | undefined,
    localContext: boolean | undefined,
    visited: Set<Rules>,
    visibilityOverride?: RulesOptions['rulesVisibility']['VarDeclaration']
  ): {
    publicMatch: Node | undefined;
    optionalMatch: Node | undefined;
  } => {
    if (visited.has(scope)) {
      return {
        publicMatch: undefined,
        optionalMatch: undefined
      };
    }
    visited.add(scope);

    if (scope.rulesIndexed < scope.value.length) {
      scope._indexRules();
    }
    const frame = scope.getScopeFrame();
    promoteResolvedPendingDecls(scope, frame);
    let publicMatch: Node | undefined;
    let optionalMatch: Node | undefined;

    const currentCandidate = selectBucketCandidate(frame.declarationBucketsByName.get(name), undefined);
    if (currentCandidate) {
      const scopeVisibility = visibilityOverride ?? scope.options.rulesVisibility?.VarDeclaration;
      const isRulesetBodyScope = isNode(scope.parent, N.Ruleset) || isNode(scope.sourceNode, N.Ruleset);
      const isOptionalCurrentScope = visibilityOverride === undefined
        ? scopeVisibility === 'optional' && !isRulesetBodyScope
        : scopeVisibility === 'optional';
      if (isOptionalCurrentScope) {
        optionalMatch = currentCandidate;
      } else {
        publicMatch = currentCandidate;
      }
    }

    const childEntries = scope._rulesSet as Array<{
      node: Rules;
      rulesVisibility?: RulesOptions['rulesVisibility'];
    }> | undefined;
    if (!childEntries?.length) {
      return { publicMatch, optionalMatch };
    }

    for (let i = childEntries.length - 1; i >= 0; i--) {
      const entry = childEntries[i]!;
      const visibility = entry.rulesVisibility?.VarDeclaration
        ?? entry.node.options.rulesVisibility?.VarDeclaration;
      if (visibility !== 'public' && visibility !== 'optional') {
        continue;
      }
      if (entry.node.options?.isMixinOutput === true && options.hasTarget !== true) {
        continue;
      }
      if (options.context.rulesContext === scope && entry.node.options?.forward) {
        continue;
      }
      if (localContext && entry.node.options?.local) {
        continue;
      }
      if (
        scopeStart !== undefined
        && !(entry.node.index !== undefined && entry.node.index < scopeStart)
      ) {
        continue;
      }

      const childResult = findVarWithinScopeSurface(
        entry.node,
        scopeStart,
        localContext || Boolean(entry.node.options?.local),
        visited,
        visibility
      );
      publicMatch = laterOf(publicMatch, childResult.publicMatch);
      optionalMatch = laterOf(optionalMatch, childResult.optionalMatch);
    }

    return { publicMatch, optionalMatch };
  };

  let cursor: Node | undefined = startRules;
  let first = true;
  let publicMatch: Node | undefined;
  let optionalMatch: Node | undefined;
  while (cursor) {
    if (isNode(cursor, N.Rules)) {
      const scope = cursor as Rules;
      const scopeStart = first ? options.start : undefined;
      const applyCurrentScopeStart = first;
      if (!first) {
        // Stop at non-classic-import boundaries (same as DeclarationRegistry.find)
        if (isNonClassicImportBoundary(scope)) {
          break;
        }
      }
      first = false;
      const result = findVarWithinScopeSurface(
        scope,
        applyCurrentScopeStart ? scopeStart : undefined,
        options.local,
        new Set<Rules>()
      );
      publicMatch = laterOf(publicMatch, result.publicMatch);
      optionalMatch = laterOf(optionalMatch, result.optionalMatch);
      // No match at this scope; continue up the chain
    }
    cursor = cursor.parent;
  }
  const fallbackFrame = startRules.scopeFrame?.fallbackFrame;
  const fallbackRules = fallbackFrame?.rulesNode;
  if (publicMatch === undefined && optionalMatch === undefined && isNode(fallbackRules, N.Rules)) {
    cursor = fallbackRules as Rules;
    while (cursor) {
      if (isNode(cursor, N.Rules)) {
        const scope = cursor as Rules;
        if (isNonClassicImportBoundary(scope)) {
          break;
        }
        const result = findVarWithinScopeSurface(
          scope,
          undefined,
          options.local,
          new Set<Rules>()
        );
        publicMatch = laterOf(publicMatch, result.publicMatch);
        optionalMatch = laterOf(optionalMatch, result.optionalMatch);
      }
      const nextFallbackRules = isNode(cursor, N.Rules)
        ? cursor.scopeFrame?.fallbackFrame?.rulesNode
        : undefined;
      cursor = isNode(nextFallbackRules, N.Rules)
        ? nextFallbackRules
        : cursor.parent;
    }
  }
  if (publicMatch !== undefined) {
    return {
      match: publicMatch
    };
  }
  if (optionalMatch !== undefined) {
    return {
      match: optionalMatch
    };
  }
  return { match: undefined };
}

const { isArray } = Array;

function isInsideSelectorCapture(node: Node | undefined): boolean {
  let cursor: Node | undefined = node;
  while (cursor) {
    if (cursor.type === 'SelectorCapture') {
      return true;
    }
    cursor = cursor.parent;
  }
  return false;
}

function normalizeSelectorReferenceKey(selector: Selector): string | string[] {
  if (isNode(selector, N.BasicSelector) || selector.type === 'InterpolatedSelector') {
    return selector.valueOf();
  }

  if (isNode(selector, N.CompoundSelector)) {
    return getOrderedSelectorKeys(selector);
  }

  if (isNode(selector, N.ComplexSelector)) {
    for (const node of selector.value as Node[]) {
      if (
        isNode(node, N.BasicSelector | N.CompoundSelector)
        || node.type === 'InterpolatedSelector'
      ) {
        continue;
      }
      if (isNode(node, N.Combinator) && (node.value === '>' || node.value === ' ')) {
        continue;
      }
      return selector.valueOf();
    }

    const path = getOrderedSelectorKeys(selector);
    if (path.length > 0) {
      return path;
    }
  }

  return selector.valueOf();
}

function getLookupStartIndex(node: Node): number | undefined {
  let startIndex = node.index;
  let currentNode: Node | undefined = node;

  if (startIndex === undefined) {
    while (currentNode && startIndex === undefined) {
      currentNode = currentNode.parent;
      if (currentNode) {
        startIndex = currentNode.index;
      }
    }
  }

  while (currentNode && currentNode.parent && !isNode(currentNode.parent, N.Rules)) {
    currentNode = currentNode.parent;
    if (currentNode && currentNode.index !== undefined) {
      startIndex = currentNode.index;
    }
  }

  return startIndex;
}

type LookupType = NonNullable<ReferenceOptions['type']>;
type NormalizedLookupKey = string | string[] | number;
type RulesLookupResult = RuntimeVarBinding | Node | MixinEntry[] | undefined;

type RulesLookupAdapterEnv = {
  context: Context;
  keyNode: ReferenceValue['key'];
  hasTarget: boolean;
  inCall: boolean;
  isInterpolatedVariable: boolean;
  filter: (n: Node) => boolean;
};

type RulesLookupAdapter = {
  applyContextualStart: boolean;
  lookup: (
    targetRules: Rules,
    valueKey: NormalizedLookupKey,
    opts: FindOptions,
    env: RulesLookupAdapterEnv
  ) => RulesLookupResult;
};

type PreparedReferenceLookup = {
  adapter: RulesLookupAdapter;
  env: RulesLookupAdapterEnv;
};

type ReferenceLookupResultKind = 'fallback' | 'runtime-binding' | 'declaration' | 'direct';

function getLookupKeyString(valueKey: NormalizedLookupKey): string {
  return Array.isArray(valueKey) ? (valueKey[0] ?? '') : `${valueKey}`;
}

function getLookupKeyDisplay(valueKey: NormalizedLookupKey): string {
  return Array.isArray(valueKey) ? valueKey.join('') : String(valueKey);
}

function isWithinReferenceParamVarScope(
  paramParent: Node | undefined,
  activeRules: Node | undefined
): boolean {
  const sourceParamParent = paramParent?.sourceNode as Node | undefined;
  let cursor: Node | undefined = activeRules;
  while (cursor) {
    const sourceCursor = cursor.sourceNode as Node | undefined;
    if (
      cursor === paramParent
      || cursor === sourceParamParent
      || sourceCursor === paramParent
      || (sourceCursor && sourceParamParent && sourceCursor === sourceParamParent)
    ) {
      return true;
    }
    cursor = cursor.parent;
  }
  return false;
}

function isBlockedReferenceParamVar(
  node: Node,
  context: Context
): boolean {
  return (
    isNode(node, N.VarDeclaration)
    && Boolean(node.options?.paramVar)
    && !isWithinReferenceParamVarScope(node.parent, context.rulesContext)
  );
}

function isBlockedReferenceSearchScope(
  node: Node,
  context: Context
): boolean {
  return context.searchScope.has(node);
}

function buildReferenceFilter(
  originalFilter: ReferenceOptions['filter'] | undefined,
  context: Context
): (n: Node) => boolean {
  const passesOriginal = originalFilter ?? (() => true);

  return (n: Node) => {
    return (
      passesOriginal(n)
      && !isBlockedReferenceSearchScope(n, context)
      && !isBlockedReferenceParamVar(n, context)
    );
  };
}

function shouldUseLocalReferenceLookup(args: {
  target: ReferenceValue['target'];
  targetRules: Rules;
}): boolean {
  return !args.target && args.targetRules.options?.isMixinOutput === true;
}

function getContextualReferenceLookupStart(args: {
  referenceNode: Reference;
  target: ReferenceValue['target'];
  isInterpolatedVariable: boolean;
  adapter: RulesLookupAdapter;
}): Pick<FindOptions, 'start' | 'ignoreParentScopeStart'> {
  const { referenceNode, target, isInterpolatedVariable, adapter } = args;
  if (target || isInterpolatedVariable || !adapter.applyContextualStart) {
    return {};
  }
  const startIndex = getLookupStartIndex(referenceNode);
  if (startIndex === undefined) {
    return {};
  }
  return {
    start: startIndex,
    ignoreParentScopeStart: true
  };
}

function getLiveReferenceLookupStart(args: {
  referenceNode: Reference;
  resolution: ReferenceOptions['resolution'];
  isInterpolatedVariable: boolean;
  context: Context;
}): Pick<FindOptions, 'start'> {
  const { referenceNode, resolution, isInterpolatedVariable, context } = args;
  if (resolution !== 'live' || isInterpolatedVariable) {
    return {};
  }
  if (context.rulesContext !== undefined) {
    return { start: context.rulesContext.index };
  }
  const startIndex = getLookupStartIndex(referenceNode);
  return startIndex === undefined ? {} : { start: startIndex };
}

function buildReferenceLookupOptions(args: {
  referenceNode: Reference;
  target: ReferenceValue['target'];
  targetRules: Rules;
  resolution: ReferenceOptions['resolution'];
  isInterpolatedVariable: boolean;
  filter: (n: Node) => boolean;
  context: Context;
  hasTarget: boolean;
  adapter: RulesLookupAdapter;
}): FindOptions {
  const {
    referenceNode,
    target,
    targetRules,
    resolution,
    isInterpolatedVariable,
    filter,
    context,
    hasTarget,
    adapter
  } = args;
  return {
    filter,
    context,
    hasTarget,
    ...(shouldUseLocalReferenceLookup({ target, targetRules }) ? { local: true } : {}),
    ...getContextualReferenceLookupStart({
      referenceNode,
      target,
      isInterpolatedVariable,
      adapter
    }),
    ...getLiveReferenceLookupStart({
      referenceNode,
      resolution,
      isInterpolatedVariable,
      context
    })
  };
}

function prepareReferenceLookup(args: {
  referenceNode: Reference;
  lookupType: LookupType;
  keyNode: ReferenceValue['key'];
  target: ReferenceValue['target'];
  originalFilter: ReferenceOptions['filter'] | undefined;
  context: Context;
}): PreparedReferenceLookup {
  const {
    referenceNode,
    lookupType,
    keyNode,
    target,
    originalFilter,
    context
  } = args;
  const isInterpolatedVariable = (
    lookupType === 'variable'
    && referenceNode.parent?.type === 'Interpolated'
  );
  const filter = buildReferenceFilter(originalFilter, context);
  const hasTarget = !!target;
  return {
    adapter: RULES_LOOKUP_ADAPTERS[lookupType],
    env: {
      context,
      keyNode,
      hasTarget,
      inCall: isNode(referenceNode.parent, N.Call),
      isInterpolatedVariable,
      filter
    }
  };
}

function lookupRuntimeVarBinding(
  targetRules: Rules,
  key: string,
  context: Context
): RuntimeVarBinding | undefined {
  const frame = targetRules.getScopeFrame();
  const seen = new Set<ScopeFrame>();
  const searchChain = (start: ScopeFrame | undefined): RuntimeVarBinding | undefined => {
    let f = start;
    while (f && !seen.has(f)) {
      seen.add(f);
      const live = f.liveSlotsByName.get(key);
      if (live) {
        const src = live.sourceNode as Node | undefined;
        if (!src || !context.searchScope.has(src)) {
          return {
            kind: 'runtime-var-binding',
            value: live.value,
            readonly: live.readonly,
            sourceNode: src
          } satisfies RuntimeVarBinding;
        }
      }
      f = f.parent;
    }
    return undefined;
  };

  const direct = searchChain(frame);
  if (direct) {
    return direct;
  }

  let fallback = frame.fallbackFrame;
  while (fallback) {
    const resolved = searchChain(fallback);
    if (resolved) {
      return resolved;
    }
    fallback = fallback.fallbackFrame;
  }
  return undefined;
}

function lookupIndexReference(
  targetRules: Rules,
  valueKey: NormalizedLookupKey,
  opts: FindOptions,
  env: RulesLookupAdapterEnv
): RulesLookupResult {
  if (typeof valueKey === 'number') {
    return targetRules.at(valueKey);
  }
  const keyStr = getLookupKeyString(valueKey);
  return targetRules.find('declaration', keyStr, getIndexReferenceFilterType(env.keyNode), opts);
}

function lookupPropertyReference(
  targetRules: Rules,
  valueKey: NormalizedLookupKey,
  opts: FindOptions
): RulesLookupResult {
  return targetRules.find('declaration', getLookupKeyString(valueKey), 'Declaration', opts);
}

function lookupVariableReference(
  targetRules: Rules,
  valueKey: NormalizedLookupKey,
  opts: FindOptions,
  env: RulesLookupAdapterEnv
): RulesLookupResult {
  const keyStr = getLookupKeyString(valueKey);
  const live = lookupRuntimeVarBinding(targetRules, keyStr, env.context);
  if (live) {
    return live;
  }
  const fast = findVarDeclarationFast(targetRules, keyStr, env.filter, {
    start: opts.start,
    context: env.context,
    hasTarget: env.hasTarget,
    local: opts.local
  });
  return fast.match;
}

function lookupDeclarationReference(
  targetRules: Rules,
  valueKey: NormalizedLookupKey,
  opts: FindOptions
): RulesLookupResult {
  return targetRules.find('declaration', getLookupKeyString(valueKey), undefined, opts);
}

function lookupFunctionReference(
  targetRules: Rules,
  valueKey: NormalizedLookupKey,
  opts: FindOptions,
  env: RulesLookupAdapterEnv
): RulesLookupResult {
  const keyStr = getLookupKeyString(valueKey);
  if (env.inCall) {
    return (
      targetRules.find('function', keyStr, undefined, opts)
      ?? targetRules.find('declaration', keyStr, undefined, opts)
    );
  }
  return (
    targetRules.find('declaration', keyStr, undefined, opts)
    ?? targetRules.find('function', keyStr, undefined, opts)
  );
}

function lookupCallableReference(
  targetRules: Rules,
  valueKey: NormalizedLookupKey,
  opts: FindOptions,
  env: RulesLookupAdapterEnv,
  filterType?: 'Mixin'
): RulesLookupResult {
  const callable = targetRules.find('mixin', valueKey, filterType, opts);
  if (callable) {
    return callable;
  }
  if (env.inCall) {
    return targetRules.find('function', getLookupKeyString(valueKey), undefined, opts);
  }
  return undefined;
}

function getIndexReferenceFilterType(
  keyNode: ReferenceValue['key']
): 'Declaration' | 'VarDeclaration' {
  return isNode(keyNode, N.Quoted) ? 'Declaration' : 'VarDeclaration';
}

function createRulesLookupAdapter(
  applyContextualStart: boolean,
  lookup: RulesLookupAdapter['lookup']
): RulesLookupAdapter {
  return { applyContextualStart, lookup };
}

function createCallableLookupAdapter(
  filterType?: 'Mixin'
): RulesLookupAdapter {
  return createRulesLookupAdapter(false, (targetRules, valueKey, opts, env) => (
    lookupCallableReference(targetRules, valueKey, opts, env, filterType)
  ));
}

const RULES_LOOKUP_ADAPTERS: Record<LookupType, RulesLookupAdapter> = {
  index: createRulesLookupAdapter(false, lookupIndexReference),
  property: createRulesLookupAdapter(true, lookupPropertyReference),
  variable: createRulesLookupAdapter(true, lookupVariableReference),
  declaration: createRulesLookupAdapter(true, lookupDeclarationReference),
  function: createRulesLookupAdapter(false, lookupFunctionReference),
  mixin: createCallableLookupAdapter('Mixin'),
  ['mixin-ruleset']: createCallableLookupAdapter()
};

function lookupAcrossRulesScopes(
  scopes: Array<Rules | Node | undefined>,
  performLookup: (scope: Rules) => RulesLookupResult
): MaybePromise<RulesLookupResult> {
  const walk = (index: number): MaybePromise<RulesLookupResult> => {
    for (let i = index; i < scopes.length; i++) {
      const scope = scopes[i];
      if (!isNode(scope, N.Rules)) {
        continue;
      }
      const result = performLookup(scope);
      if (isThenable(result)) {
        return Promise.resolve(result).then((resolved) => {
          if (resolved !== undefined) {
            return resolved;
          }
          return walk(i + 1);
        });
      }
      if (result !== undefined) {
        return result;
      }
    }
    return undefined;
  };

  return walk(0);
}

function getReferenceLookupScopes(args: {
  resolvedTarget: Rules;
  context: Context;
  rulesParent: Rules | undefined;
  sourceRulesParent: Rules | undefined;
}): Array<Rules | Node | undefined> {
  const { resolvedTarget, context, rulesParent, sourceRulesParent } = args;
  return context.leakyRules
    ? [resolvedTarget, rulesParent, sourceRulesParent]
    : [resolvedTarget];
}

function lookupRulesReferenceTarget(args: {
  resolvedTarget: Rules;
  context: Context;
  rulesParent: Rules | undefined;
  sourceRulesParent: Rules | undefined;
  performRulesLookup: (scope: Rules) => RulesLookupResult;
}): MaybePromise<RulesLookupResult> {
  return lookupAcrossRulesScopes(
    getReferenceLookupScopes(args),
    args.performRulesLookup
  );
}

function lookupReferenceTarget(args: {
  resolvedTarget: Node | undefined;
  lookupType: LookupType;
  valueKey: NormalizedLookupKey;
  keyNode: ReferenceValue['key'];
  context: Context;
  rulesParent: Rules | undefined;
  sourceRulesParent: Rules | undefined;
  performRulesLookup: (scope: Rules) => RulesLookupResult;
}): MaybePromise<RulesLookupResult> {
  const {
    resolvedTarget,
    lookupType,
    valueKey,
    keyNode,
    context,
    rulesParent,
    sourceRulesParent,
    performRulesLookup
  } = args;

  if (!isNode(resolvedTarget, N.Rules)) {
    return lookupDirectTarget(resolvedTarget, lookupType, valueKey, keyNode);
  }

  return lookupRulesReferenceTarget({
    resolvedTarget,
    context,
    rulesParent,
    sourceRulesParent,
    performRulesLookup
  });
}

function createRulesReferenceLookupExecutor(args: {
  referenceNode: Reference;
  target: ReferenceValue['target'];
  resolution: ReferenceOptions['resolution'];
  isInterpolatedVariable: boolean;
  filter: (n: Node) => boolean;
  context: Context;
  hasTarget: boolean;
  adapter: RulesLookupAdapter;
  valueKey: NormalizedLookupKey;
  env: RulesLookupAdapterEnv;
}): (scope: Rules) => RulesLookupResult {
  const {
    referenceNode,
    target,
    resolution,
    isInterpolatedVariable,
    filter,
    context,
    hasTarget,
    adapter,
    valueKey,
    env
  } = args;

  return (scope: Rules): RulesLookupResult => {
    const opts = buildReferenceLookupOptions({
      referenceNode,
      target,
      targetRules: scope,
      resolution,
      isInterpolatedVariable,
      filter,
      context,
      hasTarget,
      adapter
    });
    return adapter.lookup(scope, valueKey, opts, env);
  };
}

function lookupResolvedReference(args: {
  referenceNode: Reference;
  resolvedTarget: unknown;
  lookupType: LookupType;
  valueKey: NormalizedLookupKey;
  target: ReferenceValue['target'];
  originalFilter: ReferenceOptions['filter'] | undefined;
  context: Context;
}): MaybePromise<{
  returnVal: RulesLookupResult;
  valueKey: NormalizedLookupKey;
}> {
  const {
    referenceNode,
    resolvedTarget,
    lookupType,
    valueKey,
    target,
    originalFilter,
    context
  } = args;
  const { adapter, env } = prepareReferenceLookup({
    referenceNode,
    lookupType,
    keyNode: referenceNode.value.key,
    target,
    originalFilter,
    context
  });

  const performLookup = createRulesReferenceLookupExecutor({
    referenceNode,
    target,
    resolution: referenceNode.options.resolution,
    isInterpolatedVariable: env.isInterpolatedVariable,
    filter: env.filter,
    context,
    hasTarget: env.hasTarget,
    adapter,
    valueKey,
    env
  });

  const returnVal = lookupReferenceTarget({
    resolvedTarget: isNode(resolvedTarget) ? resolvedTarget : undefined,
    lookupType,
    valueKey,
    keyNode: referenceNode.value.key,
    context,
    rulesParent: referenceNode.rulesParent,
    sourceRulesParent: referenceNode.sourceRulesParent,
    performRulesLookup: performLookup
  });

  if (isThenable(returnVal)) {
    return Promise.resolve(returnVal).then(resolved => ({
      returnVal: resolved,
      valueKey
    }));
  }
  return { returnVal, valueKey };
}

function lookupDirectTarget(
  targetNode: Node | undefined,
  lookupType: LookupType,
  valueKey: NormalizedLookupKey,
  keyNode: ReferenceValue['key']
): RulesLookupResult {
  if (lookupType !== 'index' || !targetNode) {
    return undefined;
  }
  if (typeof valueKey === 'number') {
    return lookupDirectArrayIndexTarget(targetNode, valueKey);
  }
  return lookupDirectNamedTarget(targetNode, getLookupKeyString(valueKey), keyNode);
}

function lookupDirectArrayIndexTarget(
  targetNode: Node,
  valueKey: number
): RulesLookupResult {
  if (!isNode(targetNode, N.JsArray)) {
    return undefined;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return atIndex((targetNode as any).value, valueKey);
}

function getDirectRulesIndexFilterType(
  keyNode: ReferenceValue['key']
): 'Declaration' | 'VarDeclaration' {
  return isNode(keyNode, N.Quoted) ? 'Declaration' : 'VarDeclaration';
}

function lookupDirectRulesTarget(
  targetNode: Rules,
  key: string,
  keyNode: ReferenceValue['key']
): RulesLookupResult {
  return targetNode.find('declaration', key, getDirectRulesIndexFilterType(keyNode));
}

function lookupDirectNamedTarget(
  targetNode: Node,
  key: string,
  keyNode: ReferenceValue['key']
): RulesLookupResult {
  if (isNode(targetNode, N.JsObject)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return (targetNode as any).value[key];
  }
  if (isNode(targetNode, N.Rules)) {
    return lookupDirectRulesTarget(targetNode, key, keyNode);
  }
  return undefined;
}

function getReferenceNotFoundError(type: LookupType, keyDisplay: string): ReferenceError {
  if (type === 'mixin' || type === 'mixin-ruleset') {
    return new ReferenceError(`No matching mixins found for '${keyDisplay}'`);
  }
  return new ReferenceError(`'${keyDisplay}' is not defined`);
}

function evaluateReferenceKey(
  key: ReferenceValue['key'],
  resolvedTarget: unknown,
  context: Context
): MaybePromise<[unknown, NormalizedLookupKey]> {
  const out = isNode(key) ? key.eval(context) : key;

  const finalizeKey = (resolvedKey: unknown): [unknown, NormalizedLookupKey] => {
    if (isNode(resolvedKey, N.Selector)) {
      return [resolvedTarget, normalizeSelectorReferenceKey(resolvedKey)];
    }
    if (Array.isArray(resolvedKey)) {
      return [resolvedTarget, resolvedKey.map(String)];
    }
    const normalizedKey = isNode(resolvedKey) ? resolvedKey.valueOf() : resolvedKey;
    if (typeof normalizedKey === 'string' || typeof normalizedKey === 'number') {
      return [resolvedTarget, normalizedKey];
    }
    return [resolvedTarget, String(normalizedKey)];
  };

  if (isThenable(out)) {
    return Promise.resolve(out).then(finalizeKey);
  }
  return finalizeKey(out);
}

function resolveInitialReferenceTarget(
  referenceNode: Reference,
  context: Context
): MaybePromise<unknown> {
  const { target } = referenceNode.value;
  const resolvedTarget = target
    ? target.eval(context)
    : context.rulesContext ?? referenceNode.rulesParent;
  if (isThenable(resolvedTarget)) {
    return Promise.resolve(resolvedTarget);
  }
  return resolvedTarget;
}

function getRedirectReferenceTargetKey(resolvedTarget: unknown): string | undefined {
  if (!(resolvedTarget instanceof Node)) {
    return undefined;
  }
  if (resolvedTarget instanceof MixinCollection || isNode(resolvedTarget, N.Rules | N.JsFunction | N.Mixin)) {
    return undefined;
  }
  const targetKey = isNode(resolvedTarget, N.Color)
    ? String((resolvedTarget as Color).value.node)
    : resolvedTarget.valueOf();
  return typeof targetKey === 'string' ? targetKey : undefined;
}

function resolveAmbiguousReferenceTarget(args: {
  referenceNode: Reference;
  resolvedTarget: unknown;
  context: Context;
}): MaybePromise<unknown> {
  const { referenceNode, context, resolvedTarget } = args;
  const targetKey = getRedirectReferenceTargetKey(resolvedTarget);
  if (targetKey !== undefined) {
    const refNode = new Reference(targetKey, { type: 'mixin-ruleset' });
    referenceNode.adopt(refNode);
    return refNode.eval(context);
  }
  return resolvedTarget;
}

function materializeMixinCollectionTarget(
  resolvedTarget: MixinCollection,
  valueKey: NormalizedLookupKey,
  context: Context
): MaybePromise<[unknown, NormalizedLookupKey]> {
  return Promise.resolve(resolvedTarget.evalCall(context)).then(r => [r, valueKey]);
}

function materializeJsFunctionTarget(
  resolvedTarget: Node,
  valueKey: NormalizedLookupKey,
  context: Context
): MaybePromise<[unknown, NormalizedLookupKey]> {
  const jsResult = resolvedTarget.value.call(context);
  if (isThenable(jsResult)) {
    return Promise.resolve(jsResult).then(result => [result, valueKey]);
  }
  return [jsResult, valueKey];
}

function materializeRulesLikeTarget(
  resolvedTarget: Rules | Node,
  valueKey: NormalizedLookupKey,
  context: Context
): MaybePromise<[Rules, NormalizedLookupKey]> {
  const mixinResult = resolvedTarget.value.rules.eval(context);
  const finalizeRules = (rules: Rules): [Rules, NormalizedLookupKey] => {
    rules.inherit(resolvedTarget.value.rules);
    return [rules, valueKey];
  };
  if (isThenable(mixinResult)) {
    return Promise.resolve(mixinResult).then(finalizeRules);
  }
  return finalizeRules(mixinResult);
}

function materializeReferenceTarget(args: {
  resolvedTarget: unknown;
  valueKey: NormalizedLookupKey;
  context: Context;
}): MaybePromise<[unknown, NormalizedLookupKey]> {
  const { context, valueKey } = args;
  const { resolvedTarget } = args;

  if (resolvedTarget instanceof MixinCollection) {
    return materializeMixinCollectionTarget(resolvedTarget, valueKey, context);
  }
  if (isNode(resolvedTarget, N.JsFunction)) {
    return materializeJsFunctionTarget(resolvedTarget, valueKey, context);
  }
  if (isNode(resolvedTarget, N.Mixin | N.Ruleset)) {
    return materializeRulesLikeTarget(resolvedTarget, valueKey, context);
  }

  return [resolvedTarget, valueKey];
}

function resolveReferenceTargetValue(args: {
  referenceNode: Reference;
  resolvedTarget: unknown;
  valueKey: NormalizedLookupKey;
  context: Context;
}): MaybePromise<[unknown, NormalizedLookupKey]> {
  const { valueKey } = args;
  return pipe(
    () => resolveAmbiguousReferenceTarget(args),
    resolvedTarget => materializeReferenceTarget({
      resolvedTarget,
      valueKey,
      context: args.context
    })
  );
}

function applyReferenceResultMetadata(
  referenceNode: Reference,
  node: Node,
  options?: { frozen?: boolean }
): Node {
  if (options?.frozen) {
    node.frozen = true;
  }
  node.pre = referenceNode.pre;
  node.post = referenceNode.post;
  return node;
}

function cloneReferenceResultNode(
  referenceNode: Reference,
  node: Node
): Node {
  return applyReferenceResultMetadata(
    referenceNode,
    node.copy(true, freezeChildren).inherit(node),
    { frozen: true }
  );
}

function finalizeFallbackReferenceResult(args: {
  referenceNode: Reference;
  valueKey: NormalizedLookupKey;
  lookupType: LookupType;
  fallbackValue: ReferenceOptions['fallbackValue'];
  context: Context;
}): MaybePromise<Node> {
  const { referenceNode, valueKey, lookupType, fallbackValue, context } = args;
  const valueKeyStr = getLookupKeyDisplay(valueKey);

  if (!fallbackValue) {
    if (
      (lookupType === 'mixin' || lookupType === 'mixin-ruleset')
      && isInsideSelectorCapture(referenceNode)
    ) {
      return new Any(valueKeyStr, { role: 'ident' });
    }
    throw getReferenceNotFoundError(lookupType, valueKeyStr);
  }
  if (fallbackValue === true) {
    const any = new Any(`${valueKey}`);
    any.options.role = referenceNode.options.role;
    return any;
  }
  const out = fallbackValue.eval(context);
  if (isThenable(out)) {
    return Promise.resolve(out).then(node => node);
  }
  return out;
}

function finalizeDirectReferenceResult(
  referenceNode: Reference,
  returnVal: unknown,
  context: Context
): Node {
  if (isArray(returnVal)) {
    return createDirectCallableReferenceResult(referenceNode, returnVal);
  }
  return finalizeDirectNodeReferenceResult(referenceNode, cast(returnVal), context);
}

function createDirectCallableReferenceResult(
  referenceNode: Reference,
  returnVal: unknown[]
): Node {
  const callableItems: MixinEntry[] = [];
  for (const item of returnVal) {
    if (!isNode(item, N.Mixin | N.Ruleset)) {
      return cast(undefined);
    }
    callableItems.push(item);
  }
  const collection = new MixinCollection(callableItems);
  return collection;
}

function finalizeDirectNodeReferenceResult(
  referenceNode: Reference,
  result: Node,
  context: Context
): Node {
  context.popReference();
  return result;
}

function finalizeRuntimeVarBindingResult(
  referenceNode: Reference,
  binding: RuntimeVarBinding,
  context: Context
): MaybePromise<Node> {
  const bindingSource = binding.sourceNode;
  if (bindingSource) {
    context.searchScope.add(bindingSource);
  }
  const finalizeRuntimeBinding = (evald: Node) => {
    if (bindingSource) {
      context.searchScope.delete(bindingSource);
    }
    return cloneReferenceResultNode(referenceNode, evald);
  };
  const evaluatedBinding = (() => {
    binding.value.frozen = true;
    try {
      return binding.value.eval(context);
    } catch (error) {
      if (bindingSource) {
        context.searchScope.delete(bindingSource);
      }
      throw error;
    }
  })();
  if (isThenable(evaluatedBinding)) {
    return Promise.resolve(evaluatedBinding)
      .then(finalizeRuntimeBinding, (error) => {
        if (bindingSource) {
          context.searchScope.delete(bindingSource);
        }
        throw error;
      });
  }
  return finalizeRuntimeBinding(evaluatedBinding);
}

function withReferenceSearchScope<T>(
  context: Context,
  node: Node,
  work: () => MaybePromise<T>
): MaybePromise<T> {
  context.searchScope.add(node);
  const cleanup = () => {
    context.searchScope.delete(node);
  };
  try {
    const result = work();
    if (isThenable(result)) {
      return Promise.resolve(result).then(
        (resolved) => {
          cleanup();
          return resolved;
        },
        (error) => {
          cleanup();
          throw error;
        }
      );
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

function hasImportantDeclarationValue(
  declaration: Declaration | VarDeclaration
): boolean {
  return isNode(declaration, N.Declaration) && !!declaration.value.important;
}

function isMergedAssignDeclaration(
  declaration: Declaration | VarDeclaration
): boolean {
  if (!isNode(declaration, N.Declaration)) {
    return false;
  }
  const normalizedAssign = declaration.options?.normalizedFromAssign;
  return normalizedAssign === '+:' || normalizedAssign === '&,:' || normalizedAssign === '&_:';
}

function finalizeEvaluatedDeclarationReference(
  referenceNode: Reference,
  evaluatedNode: Node,
  isMergedAssign: boolean
): Node {
  return applyReferenceResultMetadata(
    referenceNode,
    normalizeMergedAssignReferenceResult(
      cloneReferenceResultNode(referenceNode, evaluatedNode),
      isMergedAssign
    ),
    { frozen: true }
  );
}

function finalizeDeclarationReferenceResult(
  referenceNode: Reference,
  declaration: Declaration | VarDeclaration,
  context: Context
): MaybePromise<Node> {
  return withReferenceSearchScope(context, declaration, () => pipe(
    () => evaluateDeclarationReferenceValue({
      declValue: declaration.value.value,
      hasImportant: hasImportantDeclarationValue(declaration),
      context
    }),
    evaluatedNode => finalizeEvaluatedDeclarationReference(
      referenceNode,
      evaluatedNode,
      isMergedAssignDeclaration(declaration)
    )
  ));
}

function evaluateDeclarationReferenceValue(args: {
  declValue: Node;
  hasImportant: boolean;
  context: Context;
}): MaybePromise<Node> {
  const { declValue, hasImportant, context } = args;
  if (hasImportant) {
    context.pushImportantSource();
  }
  declValue.frozen = true;
  if (isNode(declValue, N.Reference) && declValue.options?.type === 'mixin-ruleset') {
    return declValue;
  }
  return declValue.eval(context);
}

function normalizeMergedAssignReferenceResult(
  node: Node,
  isMergedAssign: boolean
): Node {
  if (!isMergedAssign || !isNode(node, N.List)) {
    return node;
  }
  const mergedItems: Node[] = [];
  const collect = (child: Node): void => {
    if (isNode(child, N.List)) {
      for (const item of child.value) {
        collect(item as Node);
      }
      return;
    }
    const isEmptyPlaceholder = (
      isNode(child, N.Nil)
      || String(child.valueOf?.() ?? '') === ''
    );
    if (!isEmptyPlaceholder) {
      mergedItems.push(child.copy(true, freezeChildren));
    }
  };
  collect(node);
  if (mergedItems.length === 0) {
    return new Nil();
  }
  if (mergedItems.length === 1) {
    return mergedItems[0]!;
  }
  return new List(mergedItems);
}

function classifyReferenceLookupResult(returnVal: RulesLookupResult | unknown): ReferenceLookupResultKind {
  if (returnVal === undefined) {
    return 'fallback';
  }
  if (isRuntimeVarBinding(returnVal)) {
    return 'runtime-binding';
  }
  if (isNode(returnVal, N.Declaration | N.VarDeclaration)) {
    return 'declaration';
  }
  return 'direct';
}

function finalizeReferenceLookupResult(args: {
  referenceNode: Reference;
  returnVal: RulesLookupResult | unknown;
  valueKey: NormalizedLookupKey;
  lookupType: LookupType;
  fallbackValue: ReferenceOptions['fallbackValue'];
  context: Context;
}): MaybePromise<Node> {
  const { referenceNode, returnVal, valueKey, lookupType, fallbackValue, context } = args;

  switch (classifyReferenceLookupResult(returnVal)) {
    case 'fallback':
      return finalizeFallbackReferenceResult({
        referenceNode,
        valueKey,
        lookupType,
        fallbackValue,
        context
      });
    case 'runtime-binding':
      return finalizeRuntimeVarBindingResult(referenceNode, returnVal, context);
    case 'declaration':
      return finalizeDeclarationReferenceResult(referenceNode, returnVal, context);
    case 'direct':
      return finalizeDirectReferenceResult(referenceNode, returnVal, context);
  }
}

function evaluateReferenceNode(args: {
  referenceNode: Reference;
  target: ReferenceValue['target'];
  key: ReferenceValue['key'];
  lookupType: LookupType;
  fallbackValue: ReferenceOptions['fallbackValue'];
  originalFilter: ReferenceOptions['filter'] | undefined;
  context: Context;
}): MaybePromise<Node> {
  const {
    referenceNode,
    target,
    key,
    lookupType,
    fallbackValue,
    originalFilter,
    context
  } = args;
  context.pushReference();
  return pipe(
    () => resolveInitialReferenceTarget(referenceNode, context),
    resolved => evaluateReferenceKey(key, resolved, context),
    ([resolvedTarget, valueKey]) => resolveReferenceTargetValue({
      referenceNode,
      resolvedTarget,
      valueKey,
      context
    }),
    ([resolvedTarget, valueKey]) => lookupResolvedReference({
      referenceNode,
      resolvedTarget,
      lookupType,
      valueKey: valueKey as NormalizedLookupKey,
      target,
      originalFilter,
      context
    }),
    ({ returnVal, valueKey }) => finalizeReferenceLookupResult({
      referenceNode,
      returnVal,
      valueKey: valueKey as NormalizedLookupKey,
      lookupType,
      fallbackValue,
      context
    })
  );
}

/**
 * This is a variable or property reference,
 * which can itself contain a reference (a variable variable).
 */
export class Reference extends Node<ReferenceValue, ReferenceOptions> {
  constructor(value: ReferenceValue | string, options?: ReferenceOptions, location?: LocationInfo, treeContext?: TreeContext) {
    if (typeof value === 'string') {
      value = { key: value };
    }
    super(value, options, location, treeContext);
    // References are always non-static and may be async
    this.addFlags(F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC);
  }

  override valueOf() {
    return '';
  }

  /**
   * @note - A reference renders a $ only if it has no target.
   */
  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let { type = 'variable', resolution, fallbackValue } = this.options;
    let { target, key, rawKey } = this.value;
    const emitKey = (k: any) => {
      if (typeof k === 'string' || typeof k === 'number') {
        w.add(String(k), this);
      } else if (k instanceof Node) {
        k.toString(options);
      } else if (Array.isArray(k)) {
        w.add(k.map(k => String(k)).join(''));
      } else {
        w.add(String(k));
      }
    };
    const printableKey = rawKey ?? key;
    if (target) {
      target.toString(options);
    } else {
      w.add('$');
    }
    if (resolution === 'live') {
      w.add('~');
    }
    switch (type) {
      case 'index':
        w.add('[');
        emitKey(printableKey);
        w.add(']');
        break;
      case 'variable':
        if (target) {
          w.add('.$');
        }
        emitKey(printableKey);
        break;
      case 'declaration':
        w.add('.');
        emitKey(printableKey);
        break;
      case 'property':
        if (target) {
          w.add('[');
          emitKey(printableKey);
          w.add(']');
        } else {
          w.add('.');
          emitKey(printableKey);
        }
        break;
      case 'mixin':
        w.add(' > ');
        emitKey(printableKey);
        break;
      case 'mixin-ruleset':
        w.add(' > *');
        emitKey(printableKey);
        break;
    }
    if (fallbackValue === true) {
      w.add('?');
    }
    return w.getSince(mark);
  }

  /**
   * We don't need to mark evaluated, because a reference
   * should never resolve to itself
   */
  override evalNode(context: Context): MaybePromise<Node> {
    let { target, key } = this.value;
    let { type, fallbackValue, filter: originalFilter } = this.options;
    const lookupType = (type ?? 'variable') as LookupType;
    const result = evaluateReferenceNode({
      referenceNode: this,
      target,
      key,
      lookupType,
      fallbackValue,
      originalFilter,
      context
    });
    if (isThenable(result)) {
      return (result as Promise<Node>).then(
        res => res,
        (err) => {
          throw err;
        }
      );
    }
    return result as Node;
  }
}

export const ref = defineType(Reference, 'Reference', 'ref');
