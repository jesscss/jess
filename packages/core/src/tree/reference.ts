import { defineType, Node, F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC, F_STATIC, type LocationInfo } from './node.js';
import type { Context } from '../context.js';
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
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import type { Rules, RulesOptions, RuntimeVarBinding } from './rules.js';
import type { Interpolated } from './interpolated.js';
import { copyWithReusableLeaves } from './util/cloning.js';
import type { Declaration } from './declaration.js';
import type { Color } from './color.js';
import { JsArray } from './js-array.js';
import { JsObject } from './js-object.js';
import { JsExpression } from './js-expr.js';
import { List } from './list.js';
import { Nil } from './nil.js';
import { comparePosition } from './util/compare.js';
import { getBindingCellValue, lookupScopeFrameVariable, type BindingEntry, type ScopeFrame } from './scope-frame.js';
import type { VarDeclaration } from './declaration-var.js';
import { getOrderedSelectorKeys, isNonClassicImportBoundary } from './util/registry-utils.js';
import {
  isRenderBuffer,
  writeRenderTextResult,
  type RenderBuffer
} from './util/render-buffer.js';
import { withRulesContext } from './util/context.js';
import {
  blocksAmbientMixinOutputLookup,
  canEnterMixinOutputForLookup,
  getRulesEntryVisibility
} from './util/mixin-output-slot.js';
import { MixinCollection } from './util/callable-collection.js';
import type { MixinEntry } from './util/callable-entry.js';
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
 *      - `$foo` reads the current scoped binding,
 *      - `$!foo` reads by source position
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
  /** Explicit source-position read mode for Jess `$!x`. */
  readMode?: 'snapshot';
  /**
   * Optional references just resolve to the string
   * representation if the fallback value is set to true.
   *
   * @note - Used by Less for function references
   */
  fallbackValue?: Node | true;
  filter?: (node: Node) => boolean;
  role?: AnyRole;
  preserveRulesLike?: boolean;
};

// `sourceNode` stays on the public shallow-owned surface for compatibility and
// now carries the canonical source directly.
type PreservedRulesLikeValue = Node & { sourceNode?: Node };
type NodeValueConstructor = new (
  value: unknown,
  options?: unknown,
  location?: LocationInfo
) => Node;

function isNodeValueConstructor(value: unknown): value is NodeValueConstructor {
  return typeof value === 'function';
}

const isRuntimeVarBinding = (value: unknown): value is RuntimeVarBinding => (
  value !== null
  && typeof value === 'object'
  && 'kind' in value
  && value.kind === 'runtime-var-binding'
);

function selectVarBucketCandidate(
  bucket: BindingEntry[] | undefined,
  start: number | undefined,
  filter: (n: Node) => boolean
): Node | undefined {
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
}

function laterVarMatch<T extends Node>(a: T | undefined, b: T | undefined): T | undefined {
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
  if (
    a.parent === b.parent
    && a.index !== undefined
    && b.index !== undefined
  ) {
    return a.index <= b.index ? b : a;
  }
  let position: ReturnType<typeof comparePosition>;
  try {
    position = comparePosition(a, b);
  } catch {
    return a.parent || !b.parent ? a : b;
  }
  return position !== undefined && position <= 0 ? b : a;
}

function promoteResolvedPendingVarDecls(
  scope: Rules,
  frame: ScopeFrame
): void {
  if (frame.pendingDeclarationNames.length === 0) {
    return;
  }
  const remaining: VarDeclaration[] = [];
  let mutated = false;

  for (const decl of frame.pendingDeclarationNames) {
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
    let hasEntry = false;
    for (let i = 0; i < bucket.length; i++) {
      const entry = bucket[i]!;
      const entryIdentity = entry.sourceNode.sourceNode ?? entry.sourceNode;
      if (entry.sourceNode === decl
        || entry.sourceNode === sourceIdentity
        || entryIdentity === sourceIdentity) {
        hasEntry = true;
        break;
      }
    }
    if (!hasEntry) {
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
    frame.pendingDeclarationNames = remaining;
  }
}

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
): Node | undefined {
  const findVarWithinScopeSurface = (
    scope: Rules,
    scopeStart: number | undefined,
    localContext: boolean | undefined,
    visited: Set<Rules>,
    visibilityOverride?: NonNullable<RulesOptions['rulesVisibility']>['VarDeclaration'],
    includeChildSurfaces = true
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
    promoteResolvedPendingVarDecls(scope, frame);
    let publicMatch: Node | undefined;
    let optionalMatch: Node | undefined;
    const currentCandidate = selectVarBucketCandidate(frame.declarationBucketsByName.get(name), undefined, filter);
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
    const lexicalParentRules = frame.parent?.rulesNode;
    const astRulesParent = scope.rulesParent;
    if (
      isNode(lexicalParentRules, N.Rules)
      && lexicalParentRules !== scope
      && lexicalParentRules !== astRulesParent
    ) {
      const lexicalResult = findVarWithinScopeSurface(
        lexicalParentRules as Rules,
        undefined,
        localContext,
        visited
      );
      publicMatch = laterVarMatch(publicMatch, lexicalResult.publicMatch);
      optionalMatch = laterVarMatch(optionalMatch, lexicalResult.optionalMatch);
    }

    if (!includeChildSurfaces) {
      return { publicMatch, optionalMatch };
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
      const visibility = getRulesEntryVisibility(entry, 'VarDeclaration');
      if (visibility !== 'public' && visibility !== 'optional') {
        continue;
      }
      if (!canEnterMixinOutputForLookup(entry, { type: 'VarDeclaration', hasTarget: options.hasTarget })) {
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
      publicMatch = laterVarMatch(publicMatch, childResult.publicMatch);
      optionalMatch = laterVarMatch(optionalMatch, childResult.optionalMatch);
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
        if (isNonClassicImportBoundary(scope)) {
          const boundaryResult = findVarWithinScopeSurface(
            scope,
            undefined,
            options.local,
            new Set<Rules>(),
            undefined,
            false
          );
          publicMatch = laterVarMatch(publicMatch, boundaryResult.publicMatch);
          optionalMatch = laterVarMatch(optionalMatch, boundaryResult.optionalMatch);
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
      publicMatch = laterVarMatch(publicMatch, result.publicMatch);
      optionalMatch = laterVarMatch(optionalMatch, result.optionalMatch);
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
          const boundaryResult = findVarWithinScopeSurface(
            scope,
            undefined,
            options.local,
            new Set<Rules>(),
            undefined,
            false
          );
          publicMatch = laterVarMatch(publicMatch, boundaryResult.publicMatch);
          optionalMatch = laterVarMatch(optionalMatch, boundaryResult.optionalMatch);
          break;
        }
        const result = findVarWithinScopeSurface(
          scope,
          undefined,
          options.local,
          new Set<Rules>()
        );
        publicMatch = laterVarMatch(publicMatch, result.publicMatch);
        optionalMatch = laterVarMatch(optionalMatch, result.optionalMatch);
      }
      const fallbackCandidate: unknown = isNode(cursor, N.Rules)
        ? cursor.scopeFrame?.fallbackFrame?.rulesNode
        : undefined;
      const nextFallbackRules: Rules | undefined = isNode(fallbackCandidate, N.Rules)
        ? fallbackCandidate as Rules
        : undefined;
      cursor = nextFallbackRules ?? cursor.parent;
    }
  }
  if (publicMatch !== undefined) {
    return publicMatch;
  }
  if (optionalMatch !== undefined) {
    return optionalMatch;
  }
  return undefined;
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
    for (const node of selector.value) {
      if (
        isNode(node, N.BasicSelector)
        || isNode(node, N.CompoundSelector)
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

function isRulesLookupResult(value: unknown): value is Exclude<RulesLookupResult, undefined> {
  return isRuntimeVarBinding(value) || isNode(value) || Array.isArray(value);
}

type RulesLookupAdapterEnv = {
  context: Context;
  keyNode: ReferenceValue['key'];
  readMode: ReferenceOptions['readMode'];
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

const RAW_REFERENCE_TARGET_NOT_FOUND = Symbol('RAW_REFERENCE_TARGET_NOT_FOUND');

function getLookupKeyString(valueKey: NormalizedLookupKey): string {
  return Array.isArray(valueKey) ? (valueKey[0] ?? '') : `${valueKey}`;
}

function getLookupKeyDisplay(valueKey: NormalizedLookupKey): string {
  if (!Array.isArray(valueKey)) {
    return String(valueKey);
  }
  let out = '';
  for (let i = 0; i < valueKey.length; i++) {
    out += valueKey[i];
  }
  return out;
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
  return !args.target && blocksAmbientMixinOutputLookup(args.targetRules);
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
  const opts: FindOptions = {
    filter,
    context,
    hasTarget
  };

  if (shouldUseLocalReferenceLookup({ target, targetRules })) {
    opts.local = true;
  }

  if (!isInterpolatedVariable) {
    if (resolution === 'live') {
      if (context.rulesContext !== undefined) {
        opts.start = context.rulesContext.index;
      } else {
        const startIndex = getLookupStartIndex(referenceNode);
        if (startIndex !== undefined) {
          opts.start = startIndex;
        }
      }
    } else if (!target && adapter.applyContextualStart) {
      const startIndex = getLookupStartIndex(referenceNode);
      if (startIndex !== undefined) {
        opts.start = startIndex;
        opts.ignoreParentScopeStart = true;
      }
    }
  }

  return opts;
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
      readMode: referenceNode.options.readMode,
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
        const value = getBindingCellValue(live);
        if (!src || !context.searchScope.has(src)) {
          return {
            kind: 'runtime-var-binding',
            value,
            readonly: live.readonly,
            sourceNode: src,
            rulesContext: isNode(live.rulesContext, N.Rules) ? live.rulesContext : undefined
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

function lookupScopeFrameVariableBinding(
  targetRules: Rules,
  key: string,
  opts: FindOptions,
  env: RulesLookupAdapterEnv
): RulesLookupResult {
  if (
    env.hasTarget
    || env.isInterpolatedVariable
    || (opts.start !== undefined && env.readMode !== 'snapshot')
  ) {
    return undefined;
  }
  const hit = lookupScopeFrameVariable(targetRules.getScopeFrame(), key, {
    start: opts.start,
    filter: env.filter,
    blockedSource: node => env.context.searchScope.has(node),
    includeLive: env.readMode !== 'snapshot',
    bailOnPendingDeclarations: true
  });
  if (!hit) {
    return undefined;
  }
  if (hit.kind === 'declaration') {
    return hit.entry.sourceNode;
  }
  const value = getBindingCellValue(hit.cell);
  return {
    kind: 'runtime-var-binding',
    value,
    readonly: hit.cell.readonly,
    sourceNode: hit.sourceNode,
    rulesContext: isNode(hit.cell.rulesContext, N.Rules) ? hit.cell.rulesContext : undefined
  } satisfies RuntimeVarBinding;
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
  if (!isNode(env.keyNode, N.Quoted)) {
    const live = lookupRuntimeVarBinding(targetRules, getLookupKeyString(valueKey), env.context);
    if (live) {
      return live;
    }
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
  if (typeof valueKey === 'string') {
    const frameHit = lookupScopeFrameVariableBinding(targetRules, keyStr, opts, env);
    if (frameHit) {
      return frameHit;
    }
  }
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
  return fast;
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
  const callableKey = Array.isArray(valueKey) ? valueKey : getLookupKeyString(valueKey);
  const callable = targetRules.find('mixin', callableKey, filterType, opts);
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

const RULES_LOOKUP_ADAPTERS: Record<LookupType, RulesLookupAdapter> = {
  index: { applyContextualStart: false, lookup: lookupIndexReference },
  property: { applyContextualStart: true, lookup: lookupPropertyReference },
  variable: { applyContextualStart: true, lookup: lookupVariableReference },
  declaration: { applyContextualStart: true, lookup: lookupDeclarationReference },
  function: { applyContextualStart: false, lookup: lookupFunctionReference },
  mixin: {
    applyContextualStart: false,
    lookup: (targetRules, valueKey, opts, env) => lookupCallableReference(
      targetRules,
      valueKey,
      opts,
      env,
      'Mixin'
    )
  },
  ['mixin-ruleset']: {
    applyContextualStart: false,
    lookup: lookupCallableReference
  }
};

function lookupRulesReferenceTarget(args: {
  resolvedTarget: Rules;
  context: Context;
  rulesParent: Rules | undefined;
  sourceRulesParent: Rules | undefined;
  performRulesLookup: (scope: Rules) => RulesLookupResult;
}): MaybePromise<RulesLookupResult> {
  const first = args.performRulesLookup(args.resolvedTarget);
  if (isThenable(first)) {
    return Promise.resolve(first).then((resolved) => {
      if (isRulesLookupResult(resolved) || !args.context.leakyRules) {
        return resolved;
      }
      return lookupLeakyRulesReferenceTargets(args);
    });
  }
  if (first !== undefined || !args.context.leakyRules) {
    return first;
  }
  return lookupLeakyRulesReferenceTargets(args);
}

function lookupLeakyRulesReferenceTargets(args: {
  rulesParent: Rules | undefined;
  sourceRulesParent: Rules | undefined;
  performRulesLookup: (scope: Rules) => RulesLookupResult;
}): MaybePromise<RulesLookupResult> {
  const rulesParent = args.rulesParent;
  if (isNode(rulesParent, N.Rules)) {
    const result = args.performRulesLookup(rulesParent);
    if (isThenable(result)) {
      return Promise.resolve(result).then((resolved) => {
        if (isRulesLookupResult(resolved)) {
          return resolved;
        }
        const sourceRulesParent = args.sourceRulesParent;
        return isNode(sourceRulesParent, N.Rules)
          ? args.performRulesLookup(sourceRulesParent)
          : undefined;
      });
    }
    if (result !== undefined) {
      return result;
    }
  }

  const sourceRulesParent = args.sourceRulesParent;
  return isNode(sourceRulesParent, N.Rules)
    ? args.performRulesLookup(sourceRulesParent)
    : undefined;
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
  if (!(targetNode instanceof JsArray)) {
    return undefined;
  }
  return atIndex(targetNode.value, valueKey);
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
  if (targetNode instanceof JsObject) {
    return targetNode.value[key];
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
      const normalized = new Array<string>(resolvedKey.length);
      for (let i = 0; i < resolvedKey.length; i++) {
        normalized[i] = String(resolvedKey[i]);
      }
      return [resolvedTarget, normalized];
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
  if (
    target
    && referenceNode.options.type === 'index'
    && isNode(target, N.Reference)
    && target.options.type !== 'mixin'
    && target.options.type !== 'mixin-ruleset'
  ) {
    const rawTarget = resolveRawReferenceLookupTarget(target, context);
    const finalizeRawTarget = (resolvedRawTarget: unknown): MaybePromise<unknown> => {
      if (
        resolvedRawTarget !== RAW_REFERENCE_TARGET_NOT_FOUND
        && isDirectIndexContainerTarget(referenceNode, resolvedRawTarget)
      ) {
        return resolvedRawTarget;
      }
      return target.eval(context);
    };
    if (isThenable(rawTarget)) {
      return Promise.resolve(rawTarget).then(finalizeRawTarget);
    }
    return finalizeRawTarget(rawTarget);
  }
  const runtimeRulesParent = referenceNode.rulesParent;
  const runtimeKey = referenceNode.value.rawKey ?? referenceNode.value.key;
  let runtimeLiveSlotKey: string | undefined;
  if (typeof runtimeKey === 'string') {
    runtimeLiveSlotKey = runtimeKey;
  } else if (typeof runtimeKey === 'number') {
    runtimeLiveSlotKey = String(runtimeKey);
  }
  const runtimeParentHasLiveSlot = runtimeLiveSlotKey !== undefined
    && runtimeRulesParent?.scopeFrame?.liveSlotsByName.has(runtimeLiveSlotKey);
  const resolvedTarget = target
    ? target.eval(context)
    : runtimeParentHasLiveSlot
      ? runtimeRulesParent
      : context.rulesContext ?? runtimeRulesParent;
  if (isThenable(resolvedTarget)) {
    return Promise.resolve(resolvedTarget);
  }
  return resolvedTarget;
}

function isDirectIndexContainerTarget(
  referenceNode: Reference,
  resolvedTarget: unknown
): boolean {
  return referenceNode.options.type === 'index'
    && referenceNode.value.target !== undefined
    && (
      isNode(resolvedTarget, N.List | N.Sequence | N.Rules)
      || resolvedTarget instanceof JsArray
      || resolvedTarget instanceof JsObject
    );
}

function getRedirectReferenceTargetKey(
  referenceNode: Reference,
  resolvedTarget: unknown
): string | undefined {
  if (!(resolvedTarget instanceof Node)) {
    return undefined;
  }
  if (isDirectIndexContainerTarget(referenceNode, resolvedTarget)) {
    return undefined;
  }
  if (
    resolvedTarget instanceof MixinCollection
    || isNode(resolvedTarget, N.Rules)
    || isNode(resolvedTarget, N.JsFunction)
    || isNode(resolvedTarget, N.Mixin)
  ) {
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
  const targetKey = getRedirectReferenceTargetKey(referenceNode, resolvedTarget);
  if (targetKey !== undefined) {
    const refNode = new Reference(targetKey, { type: 'mixin-ruleset' });
    referenceNode.adopt(refNode);
    return refNode.eval(context);
  }
  return resolvedTarget;
}

type JsFunctionTarget = Node<(...args: unknown[]) => unknown>;

function materializeReferenceTarget(args: {
  resolvedTarget: unknown;
  valueKey: NormalizedLookupKey;
  context: Context;
}): MaybePromise<[unknown, NormalizedLookupKey]> {
  const { context, valueKey } = args;
  const { resolvedTarget } = args;

  if (resolvedTarget instanceof MixinCollection) {
    return Promise.resolve(resolvedTarget.evalCall(context)).then(r => [r, valueKey]);
  }
  if (isNode(resolvedTarget, N.JsFunction)) {
    const jsResult = (resolvedTarget as JsFunctionTarget).value.call(context);
    if (isThenable(jsResult)) {
      return Promise.resolve(jsResult).then(result => [result, valueKey]);
    }
    return [jsResult, valueKey];
  }
  if (isNode(resolvedTarget, N.Mixin | N.Ruleset)) {
    const sourceRules = resolvedTarget.value.rules;
    const mixinResult = sourceRules.eval(context);
    const finalizeRules = (rules: Rules): [Rules, NormalizedLookupKey] => {
      rules.inherit(sourceRules);
      return [rules, valueKey];
    };
    if (isThenable(mixinResult)) {
      return Promise.resolve(mixinResult).then(finalizeRules);
    }
    return finalizeRules(mixinResult);
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
  const resolvedTarget = resolveAmbiguousReferenceTarget(args);
  if (isThenable(resolvedTarget)) {
    return Promise.resolve(resolvedTarget).then(target => materializeReferenceTarget({
      resolvedTarget: target,
      valueKey,
      context: args.context
    }));
  }
  return materializeReferenceTarget({
    resolvedTarget,
    valueKey,
    context: args.context
  });
}

function canReturnReferenceValue(node: Node): boolean {
  return node.hasFlag(F_STATIC) && !isRulesLikeReferenceValue(node);
}

function isRulesLikeReferenceValue(node: Node): boolean {
  return isNode(node, N.Rules | N.Collection | N.Mixin | N.Ruleset);
}

/**
 * Rules-like references are public/callable surfaces, not text-only render
 * containers. Keep the source children canonical, but return a shallow owned
 * surface so callers can carry lookup, parent, and source-node state without
 * mutating the source tree.
 */
function createRulesLikeReferenceSurface(directValue: MixinEntry): MixinEntry;
function createRulesLikeReferenceSurface(directValue: Node): PreservedRulesLikeValue;
function createRulesLikeReferenceSurface(directValue: Node): PreservedRulesLikeValue {
  const options = directValue.options;
  const nodeConstructor = directValue.constructor;
  if (!isNodeValueConstructor(nodeConstructor)) {
    throw new TypeError('Preserved rules-like value must have a constructable node type');
  }
  const constructed = new nodeConstructor(
    directValue.value,
    options && typeof options === 'object' ? { ...options } : undefined,
    directValue.location.length === 0 ? undefined : directValue.location
  );
  if (!(constructed instanceof Node)) {
    throw new TypeError('Preserved rules-like value must remain a Node');
  }
  const preservedValue: PreservedRulesLikeValue = constructed;
  const sourceNode = directValue.sourceNode instanceof Node ? directValue.sourceNode : directValue;
  preservedValue.parent = directValue.parent ?? sourceNode.parent;
  preservedValue.index = directValue.index ?? sourceNode.index;
  preservedValue.sourceNode = directValue;
  return preservedValue;
}

function evaluateFallbackValue(
  referenceNode: Reference,
  fallbackValue: Node,
  context: Context,
  options: { textOnly?: boolean } = {}
): MaybePromise<Node> {
  if (canReturnReferenceValue(fallbackValue)) {
    context.popReference();
    return fallbackValue;
  }
  if (options.textOnly === true && isNode(fallbackValue, N.List | N.Sequence)) {
    context.popReference();
    return fallbackValue;
  }
  if (options.textOnly === true && fallbackValue instanceof JsExpression) {
    context.popReference();
    return fallbackValue;
  }
  if (fallbackValue instanceof JsExpression) {
    const out = fallbackValue.resolve(context);
    if (isThenable(out)) {
      return Promise.resolve(out).then(
        (node) => {
          context.popReference();
          return node;
        },
        (error) => {
          context.popReference();
          throw error;
        }
      );
    }
    context.popReference();
    return out;
  }
  const out = copyWithReusableLeaves(fallbackValue).eval(context);
  if (isThenable(out)) {
    return Promise.resolve(out).then((node) => {
      context.popReference();
      return node;
    });
  }
  context.popReference();
  return out;
}

function finalizeFallbackReferenceResult(args: {
  referenceNode: Reference;
  valueKey: NormalizedLookupKey;
  lookupType: LookupType;
  fallbackValue: ReferenceOptions['fallbackValue'];
  context: Context;
  textOnly?: boolean;
}): MaybePromise<Node> {
  const { referenceNode, valueKey, lookupType, fallbackValue, context, textOnly } = args;
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
  return evaluateFallbackValue(referenceNode, fallbackValue, context, { textOnly });
}

function finalizeDirectReferenceResult(
  referenceNode: Reference,
  returnVal: unknown,
  context: Context,
  options: { textOnly?: boolean } = {}
): Node {
  if (isArray(returnVal)) {
    context.popReference();
    return createDirectCallableReferenceResult(referenceNode, returnVal);
  }
  return finalizeDirectNodeReferenceResult(referenceNode, cast(returnVal), context, options);
}

function createDirectCallableReferenceResult(
  referenceNode: Reference,
  returnVal: unknown[]
): Node {
  const callableItems: MixinEntry[] = [];
  for (const item of returnVal) {
    if (!isNode(item, N.Mixin) && !isNode(item, N.Ruleset)) {
      return cast(undefined);
    }
    const callableItem = item;
    if (referenceNode.options?.type === 'mixin-ruleset') {
      callableItems.push(createRulesLikeReferenceSurface(callableItem));
      continue;
    }
    callableItems.push(callableItem);
  }
  return new MixinCollection(callableItems);
}

function finalizeDirectNodeReferenceResult(
  referenceNode: Reference,
  result: Node,
  context: Context,
  options: { textOnly?: boolean } = {}
): Node {
  context.popReference();
  if (options.textOnly === true && canReturnReferenceValue(result)) {
    return result;
  }
  if (
    referenceNode.options?.type === 'mixin-ruleset'
    && isRulesLikeReferenceValue(result)
  ) {
    return createRulesLikeReferenceSurface(result);
  }
  return result;
}

function finalizeRuntimeVarBindingResult(
  referenceNode: Reference,
  binding: RuntimeVarBinding,
  context: Context,
  options: { textOnly?: boolean } = {}
): MaybePromise<Node> {
  const bindingSource = binding.sourceNode;
  const finalizeRuntimeBinding = (evald: Node) => {
    if (
      referenceNode.options?.preserveRulesLike === true
      && isRulesLikeReferenceValue(evald)
    ) {
      context.popReference();
      return evald;
    }
    if (canReturnReferenceValue(evald)) {
      context.popReference();
      return evald;
    }
    context.popReference();
    const resultNode = copyWithReusableLeaves(evald);
    return resultNode.inherit(referenceNode);
  };
  const shouldUseDefinitionRulesContext = isNode(bindingSource, N.VarDeclaration) && (
    bindingSource.options?.paramVar
    || (
      context.leakyRules !== true
      && isNode(binding.value, N.Rules | N.Collection)
    )
  );

  const evaluateBinding = () => evaluateReferenceValueNode(binding.value, context, {
    preserveRulesLike: referenceNode.options?.type === 'mixin-ruleset',
    reuseSourceFreeLeaves: true,
    reuseRenderTextContainers: options.textOnly === true
  });
  const evaluateInRulesContext = () => shouldUseDefinitionRulesContext
    ? withRulesContext(
        context,
        binding.rulesContext ?? bindingSource.rulesParent ?? context.rulesContext,
        evaluateBinding
      )
    : evaluateBinding();
  const evaluatedBinding = bindingSource
    ? withReferenceSearchScope(context, bindingSource, evaluateInRulesContext)
    : evaluateInRulesContext();

  if (isThenable(evaluatedBinding)) {
    return Promise.resolve(evaluatedBinding).then(finalizeRuntimeBinding);
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
  isMergedAssign: boolean,
  options: { textOnly?: boolean } = {}
): Node {
  if (options.textOnly === true && !isMergedAssign && canReturnReferenceValue(evaluatedNode)) {
    return evaluatedNode;
  }
  const resultNode = isMergedAssign
    ? evaluatedNode
    : copyWithReusableLeaves(evaluatedNode);
  const normalized = normalizeMergedAssignReferenceResult(
    resultNode,
    isMergedAssign
  );
  return normalized.inherit(referenceNode);
}

function finalizeDeclarationReferenceResult(
  referenceNode: Reference,
  declaration: Declaration | VarDeclaration,
  context: Context,
  options: { textOnly?: boolean } = {}
): MaybePromise<Node> {
  const declarationValue = declaration.value.value;
  const isMergedAssign = isMergedAssignDeclaration(declaration);
  const hasImportant = hasImportantDeclarationValue(declaration);
  if (
    context.calcFrames === 0
    && !hasImportant
    && !isMergedAssign
    && canReturnReferenceValue(declarationValue)
  ) {
    context.popReference();
    return declarationValue;
  }
  if (
    referenceNode.options?.preserveRulesLike === true
    && isNode(declarationValue, N.Rules | N.Collection)
  ) {
    const preservedValue = createRulesLikeReferenceSurface(declarationValue);
    context.popReference();
    return preservedValue;
  }
  return withReferenceSearchScope(context, declaration, () => {
    const evaluated = evaluateDeclarationReferenceValue({
      declValue: declarationValue,
      hasImportant,
      context
    });
    const finalize = (evaluatedNode: Node): Node => {
      const finalized = finalizeEvaluatedDeclarationReference(
        referenceNode,
        evaluatedNode,
        isMergedAssign,
        options
      );
      context.popReference();
      return finalized;
    };
    return isThenable(evaluated)
      ? Promise.resolve(evaluated).then(finalize)
      : finalize(evaluated);
  });
}

function evaluateCalcSlashListValue(
  declValue: Node,
  context: Context
): MaybePromise<Node> | undefined {
  if (
    context.calcFrames === 0
    || !isNode(declValue, N.List)
    || declValue.options?.sep !== '/'
    || declValue.value.length !== 2
  ) {
    return undefined;
  }

  const [left, right] = declValue.value;
  const finalize = (l: Node, r: Node): Node => {
    if (
      !isNode(l, N.Dimension)
      || !isNode(r, N.Dimension)
    ) {
      return declValue;
    }
    try {
      const out = l.operate(r, '/', context);
      return out.inherit(declValue);
    } catch {
      return declValue;
    }
  };

  const maybeLeft = left?.eval(context);
  if (isThenable(maybeLeft)) {
    return Promise.resolve(maybeLeft).then((l) => {
      const maybeRight = right?.eval(context);
      if (isThenable(maybeRight)) {
        return Promise.resolve(maybeRight).then(r => finalize(l, r));
      }
      return maybeRight ? finalize(l, maybeRight) : declValue;
    });
  }

  const maybeRight = right?.eval(context);
  if (isThenable(maybeRight)) {
    return maybeLeft
      ? Promise.resolve(maybeRight).then(r => finalize(maybeLeft, r))
      : declValue;
  }

  if (!maybeLeft || !maybeRight) {
    return declValue;
  }

  return finalize(maybeLeft, maybeRight);
}

function evaluateReferenceValueNode(
  declValue: Node,
  context: Context,
  options: {
    preserveRulesLike?: boolean;
    reuseSourceFreeLeaves?: boolean;
    reuseRenderTextContainers?: boolean;
  } = {}
): MaybePromise<Node> {
  if (
    options.preserveRulesLike === true
    && isRulesLikeReferenceValue(declValue)
  ) {
    return createRulesLikeReferenceSurface(declValue);
  }
  const calcSlashValue = evaluateCalcSlashListValue(declValue, context);
  if (calcSlashValue !== undefined) {
    return calcSlashValue;
  }
  const savedCalcFrames = context.calcFrames;
  if (savedCalcFrames !== 0) {
    context.calcFrames = 0;
  }
  try {
    if (isNode(declValue, N.Reference) && declValue.options?.type === 'mixin-ruleset') {
      return declValue;
    }
    if (
      (
        options.reuseRenderTextContainers === true
        || options.reuseSourceFreeLeaves === true
      )
      && canReturnReferenceValue(declValue)
    ) {
      return declValue;
    }
    return copyWithReusableLeaves(declValue).eval(context);
  } finally {
    context.calcFrames = savedCalcFrames;
  }
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
  return evaluateReferenceValueNode(declValue, context);
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
      mergedItems.push(child);
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

function finalizeReferenceLookupResult(args: {
  referenceNode: Reference;
  returnVal: RulesLookupResult | unknown;
  valueKey: NormalizedLookupKey;
  lookupType: LookupType;
  fallbackValue: ReferenceOptions['fallbackValue'];
  context: Context;
  textOnly?: boolean;
}): MaybePromise<Node> {
  const { referenceNode, returnVal, valueKey, lookupType, fallbackValue, context, textOnly } = args;

  if (returnVal === undefined) {
    return finalizeFallbackReferenceResult({
      referenceNode,
      valueKey,
      lookupType,
      fallbackValue,
      context,
      textOnly
    });
  }
  if (isRuntimeVarBinding(returnVal)) {
    return finalizeRuntimeVarBindingResult(referenceNode, returnVal, context, { textOnly });
  }
  if (isNode(returnVal, N.Declaration) || isNode(returnVal, N.VarDeclaration)) {
    return finalizeDeclarationReferenceResult(referenceNode, returnVal, context, { textOnly });
  }
  return finalizeDirectReferenceResult(referenceNode, returnVal, context, { textOnly });
}

function finalizeRawReferenceLookupTarget(
  returnVal: RulesLookupResult | unknown
): unknown {
  if (returnVal === undefined) {
    return RAW_REFERENCE_TARGET_NOT_FOUND;
  }
  if (isRuntimeVarBinding(returnVal)) {
    return returnVal.value;
  }
  if (isNode(returnVal, N.Declaration) || isNode(returnVal, N.VarDeclaration)) {
    return returnVal.value.value;
  }
  return returnVal;
}

function resolveRawReferenceLookupTarget(
  referenceNode: Reference,
  context: Context
): MaybePromise<unknown> {
  const { target, key } = referenceNode.value;
  const lookupType = referenceNode.options.type;
  context.pushReference();
  const initialTarget = resolveInitialReferenceTarget(referenceNode, context);

  if (isThenable(initialTarget)) {
    return Promise.resolve(initialTarget)
      .then(resolved => evaluateReferenceKey(key, resolved, context))
      .then(([resolvedTarget, valueKey]) => resolveReferenceTargetValue({
        referenceNode,
        resolvedTarget,
        valueKey,
        context
      }))
      .then(([resolvedTarget, valueKey]) => lookupResolvedReference({
        referenceNode,
        resolvedTarget,
        lookupType,
        valueKey,
        target,
        originalFilter: referenceNode.options.filter,
        context
      }))
      .then(({ returnVal }) => {
        context.popReference();
        return finalizeRawReferenceLookupTarget(returnVal);
      })
      .catch((error) => {
        context.popReference();
        throw error;
      });
  }

  const evaluatedKey = evaluateReferenceKey(key, initialTarget, context);
  if (isThenable(evaluatedKey)) {
    return Promise.resolve(evaluatedKey)
      .then(([resolvedTarget, valueKey]) => resolveReferenceTargetValue({
        referenceNode,
        resolvedTarget,
        valueKey,
        context
      }))
      .then(([resolvedTarget, valueKey]) => lookupResolvedReference({
        referenceNode,
        resolvedTarget,
        lookupType,
        valueKey,
        target,
        originalFilter: referenceNode.options.filter,
        context
      }))
      .then(({ returnVal }) => {
        context.popReference();
        return finalizeRawReferenceLookupTarget(returnVal);
      })
      .catch((error) => {
        context.popReference();
        throw error;
      });
  }

  const resolvedValue = resolveReferenceTargetValue({
    referenceNode,
    resolvedTarget: evaluatedKey[0],
    valueKey: evaluatedKey[1],
    context
  });
  if (isThenable(resolvedValue)) {
    return Promise.resolve(resolvedValue)
      .then(([resolvedTarget, valueKey]) => lookupResolvedReference({
        referenceNode,
        resolvedTarget,
        lookupType,
        valueKey,
        target,
        originalFilter: referenceNode.options.filter,
        context
      }))
      .then(({ returnVal }) => {
        context.popReference();
        return finalizeRawReferenceLookupTarget(returnVal);
      })
      .catch((error) => {
        context.popReference();
        throw error;
      });
  }

  const lookup = lookupResolvedReference({
    referenceNode,
    resolvedTarget: resolvedValue[0],
    lookupType,
    valueKey: resolvedValue[1],
    target,
    originalFilter: referenceNode.options.filter,
    context
  });
  if (isThenable(lookup)) {
    return Promise.resolve(lookup)
      .then(({ returnVal }) => {
        context.popReference();
        return finalizeRawReferenceLookupTarget(returnVal);
      })
      .catch((error) => {
        context.popReference();
        throw error;
      });
  }

  context.popReference();
  return finalizeRawReferenceLookupTarget(lookup.returnVal);
}

function canRenderRawVariableReferenceDirectly(referenceNode: Reference): boolean {
  return (referenceNode.options.type ?? 'variable') === 'variable'
    && referenceNode.value.target === undefined
    && referenceNode.options.filter === undefined
    && referenceNode.options.preserveRulesLike !== true;
}

function finalizeDirectRawRenderValue(
  referenceNode: Reference,
  returnVal: RulesLookupResult | unknown,
  context: Context
): Node | undefined {
  if (!canRenderRawVariableReferenceDirectly(referenceNode)) {
    return undefined;
  }
  const target = finalizeRawReferenceLookupTarget(returnVal);
  if (
    target === RAW_REFERENCE_TARGET_NOT_FOUND
    || !isNode(target)
    || !target.hasFlag(F_STATIC)
    || isRulesLikeReferenceValue(target)
  ) {
    return undefined;
  }
  context.popReference();
  return target;
}

function emitReferenceSyntaxKey(
  referenceNode: Reference,
  key: unknown,
  options: ReturnType<typeof getPrintOptions>
): void {
  const w = options.writer!;
  if (typeof key === 'string' || typeof key === 'number') {
    w.add(String(key), referenceNode);
    return;
  }
  if (key instanceof Node) {
    key.toString(options);
    return;
  }
  if (Array.isArray(key)) {
    let out = '';
    for (let i = 0; i < key.length; i++) {
      out += String(key[i]);
    }
    w.add(out);
    return;
  }
  w.add(String(key));
}

function evaluateReferenceNode(args: {
  referenceNode: Reference;
  target: ReferenceValue['target'];
  key: ReferenceValue['key'];
  lookupType: LookupType;
  fallbackValue: ReferenceOptions['fallbackValue'];
  originalFilter: ReferenceOptions['filter'] | undefined;
  context: Context;
  textOnly?: boolean;
  directStaticRender?: boolean;
}): MaybePromise<Node> {
  const {
    referenceNode,
    target,
    key,
    lookupType,
    fallbackValue,
    originalFilter,
    context,
    textOnly,
    directStaticRender
  } = args;
  context.pushReference();
  const initialTarget = resolveInitialReferenceTarget(referenceNode, context);
  if (isThenable(initialTarget)) {
    return Promise.resolve(initialTarget)
      .then(resolved => evaluateReferenceKey(key, resolved, context))
      .then(([resolvedTarget, valueKey]) => resolveReferenceTargetValue({
        referenceNode,
        resolvedTarget,
        valueKey,
        context
      }))
      .then(([resolvedTarget, valueKey]) => lookupResolvedReference({
        referenceNode,
        resolvedTarget,
        lookupType,
        valueKey,
        target,
        originalFilter,
        context
      }))
      .then(({ returnVal, valueKey }) => {
        const directRenderValue = directStaticRender === true
          ? finalizeDirectRawRenderValue(referenceNode, returnVal, context)
          : undefined;
        if (directRenderValue) {
          return directRenderValue;
        }
        return finalizeReferenceLookupResult({
          referenceNode,
          returnVal,
          valueKey,
          lookupType,
          fallbackValue,
          context,
          textOnly
        });
      });
  }
  const evaluatedKey = evaluateReferenceKey(key, initialTarget, context);
  if (isThenable(evaluatedKey)) {
    return Promise.resolve(evaluatedKey)
      .then(([resolvedTarget, valueKey]) => resolveReferenceTargetValue({
        referenceNode,
        resolvedTarget,
        valueKey,
        context
      }))
      .then(([resolvedTarget, valueKey]) => lookupResolvedReference({
        referenceNode,
        resolvedTarget,
        lookupType,
        valueKey,
        target,
        originalFilter,
        context
      }))
      .then(({ returnVal, valueKey }) => {
        const directRenderValue = directStaticRender === true
          ? finalizeDirectRawRenderValue(referenceNode, returnVal, context)
          : undefined;
        if (directRenderValue) {
          return directRenderValue;
        }
        return finalizeReferenceLookupResult({
          referenceNode,
          returnVal,
          valueKey,
          lookupType,
          fallbackValue,
          context,
          textOnly
        });
      });
  }
  const resolvedValue = resolveReferenceTargetValue({
    referenceNode,
    resolvedTarget: evaluatedKey[0],
    valueKey: evaluatedKey[1],
    context
  });
  if (isThenable(resolvedValue)) {
    return Promise.resolve(resolvedValue)
      .then(([resolvedTarget, valueKey]) => lookupResolvedReference({
        referenceNode,
        resolvedTarget,
        lookupType,
        valueKey,
        target,
        originalFilter,
        context
      }))
      .then(({ returnVal, valueKey }) => {
        const directRenderValue = directStaticRender === true
          ? finalizeDirectRawRenderValue(referenceNode, returnVal, context)
          : undefined;
        if (directRenderValue) {
          return directRenderValue;
        }
        return finalizeReferenceLookupResult({
          referenceNode,
          returnVal,
          valueKey,
          lookupType,
          fallbackValue,
          context,
          textOnly
        });
      });
  }
  const lookup = lookupResolvedReference({
    referenceNode,
    resolvedTarget: resolvedValue[0],
    lookupType,
    valueKey: resolvedValue[1],
    target,
    originalFilter,
    context
  });
  if (isThenable(lookup)) {
    return Promise.resolve(lookup)
      .then(({ returnVal, valueKey }) => {
        const directRenderValue = directStaticRender === true
          ? finalizeDirectRawRenderValue(referenceNode, returnVal, context)
          : undefined;
        if (directRenderValue) {
          return directRenderValue;
        }
        return finalizeReferenceLookupResult({
          referenceNode,
          returnVal,
          valueKey,
          lookupType,
          fallbackValue,
          context,
          textOnly
        });
      });
  }

  const directRenderValue = directStaticRender === true
    ? finalizeDirectRawRenderValue(referenceNode, lookup.returnVal, context)
    : undefined;
  if (directRenderValue) {
    return directRenderValue;
  }
  return finalizeReferenceLookupResult({
    referenceNode,
    returnVal: lookup.returnVal,
    valueKey: lookup.valueKey,
    lookupType,
    fallbackValue,
    context,
    textOnly
  });
}

/**
 * This is a variable or property reference,
 * which can itself contain a reference (a variable variable).
 */
export class Reference extends Node<ReferenceValue, ReferenceOptions> {
  constructor(value: ReferenceValue | string, options?: ReferenceOptions, location?: LocationInfo) {
    if (typeof value === 'string') {
      value = { key: value };
    }
    super(value, options, location);
    // References are always non-static and may be async
    this.addFlags(F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC);
  }

  override valueOf() {
    return '';
  }

  private renderReferenceSyntax(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let { type = 'variable', resolution, fallbackValue, readMode } = this.options;
    let { target, key, rawKey } = this.value;
    const printableKey = rawKey ?? key;
    if (target) {
      target.toString(options);
    } else {
      w.add('$');
    }
    if (readMode === 'snapshot') {
      w.add('!');
    }
    if (resolution === 'live') {
      w.add('~');
    }
    switch (type) {
      case 'index':
        w.add('[');
        emitReferenceSyntaxKey(this, printableKey, options);
        w.add(']');
        break;
      case 'variable':
        if (target) {
          w.add('.$');
        }
        emitReferenceSyntaxKey(this, printableKey, options);
        break;
      case 'declaration':
        w.add('.');
        emitReferenceSyntaxKey(this, printableKey, options);
        break;
      case 'property':
        if (target) {
          w.add('[');
          emitReferenceSyntaxKey(this, printableKey, options);
          w.add(']');
        } else {
          w.add('.');
          emitReferenceSyntaxKey(this, printableKey, options);
        }
        break;
      case 'mixin':
        w.add(' > ');
        emitReferenceSyntaxKey(this, printableKey, options);
        break;
      case 'mixin-ruleset':
        w.add(' > *');
        emitReferenceSyntaxKey(this, printableKey, options);
        break;
    }
    if (fallbackValue === true) {
      w.add('?');
    }
    return w.getSince(mark);
  }

  /**
   * @note - A reference renders a $ only if it has no target.
   */
  override toTrimmedString(options?: PrintOptions): string {
    return this.renderReferenceSyntax(options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const renderBuffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const renderOptions = renderBuffer ? options : bufferOrOptions;
    if (canRenderRawVariableReferenceDirectly(this) && this.options.fallbackValue === undefined) {
      const rawValue = resolveRawReferenceLookupTarget(this, context);
      if (isThenable(rawValue)) {
        return Promise.resolve(rawValue).then((value) => {
          if (
            value !== RAW_REFERENCE_TARGET_NOT_FOUND
            && isNode(value)
            && !isRulesLikeReferenceValue(value)
            && canReturnReferenceValue(value)
          ) {
            return renderBuffer
              ? writeRenderTextResult(renderBuffer, value.render(context, options))
              : value.render(context, renderOptions);
          }
          const evaluated = evaluateReferenceNode({
            referenceNode: this,
            target: this.value.target,
            key: this.value.key,
            lookupType: (this.options.type ?? 'variable') as LookupType,
            fallbackValue: this.options.fallbackValue,
            originalFilter: this.options.filter,
            context,
            textOnly: true,
            directStaticRender: true
          });
          return isThenable(evaluated)
            ? Promise.resolve(evaluated).then((node) => {
                return renderBuffer
                  ? writeRenderTextResult(renderBuffer, node.render(context, options))
                  : node.render(context, renderOptions);
              })
            : renderBuffer
              ? writeRenderTextResult(renderBuffer, evaluated.render(context, options))
              : evaluated.render(context, renderOptions);
        });
      }
      if (
        rawValue !== RAW_REFERENCE_TARGET_NOT_FOUND
        && isNode(rawValue)
        && !isRulesLikeReferenceValue(rawValue)
        && canReturnReferenceValue(rawValue)
      ) {
        return renderBuffer
          ? writeRenderTextResult(renderBuffer, rawValue.render(context, options))
          : rawValue.render(context, renderOptions);
      }
    }
    const evaluated = evaluateReferenceNode({
      referenceNode: this,
      target: this.value.target,
      key: this.value.key,
      lookupType: (this.options.type ?? 'variable') as LookupType,
      fallbackValue: this.options.fallbackValue,
      originalFilter: this.options.filter,
      context,
      textOnly: true,
      directStaticRender: true
    });
    return isThenable(evaluated)
      ? Promise.resolve(evaluated).then((node) => {
          return renderBuffer
            ? writeRenderTextResult(renderBuffer, node.render(context, options))
            : node.render(context, renderOptions);
        })
      : renderBuffer
        ? writeRenderTextResult(renderBuffer, evaluated.render(context, options))
        : evaluated.render(context, renderOptions);
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
    return result;
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }
}

export const ref = defineType(Reference, 'Reference', 'ref');
