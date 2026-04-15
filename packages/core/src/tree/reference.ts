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
import { getOrderedSelectorKeys } from './util/registry-utils.js';
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
        const sn = scope.sourceNode;
        if (sn?.type === 'StyleImport' && sn.options.type !== 'import') {
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
    cursor = cursor.parent ?? cursor.sourceParent;
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

function getLookupKeyString(valueKey: NormalizedLookupKey): string {
  return Array.isArray(valueKey) ? (valueKey[0] ?? '') : `${valueKey}`;
}

function getLookupKeyDisplay(valueKey: NormalizedLookupKey): string {
  return Array.isArray(valueKey) ? valueKey.join('') : String(valueKey);
}

function buildReferenceFilter(
  originalFilter: ReferenceOptions['filter'] | undefined,
  context: Context
): (n: Node) => boolean {
  const passesOriginal = originalFilter ?? (() => true);
  const isWithinParamVarScope = (paramParent: Node | undefined, activeRules: Node | undefined): boolean => {
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
      cursor = cursor.parent ?? cursor.sourceParent;
    }
    return false;
  };

  return (n: Node) => {
    const blockedParamVar = isNode(n, N.VarDeclaration)
      && Boolean(n.options?.paramVar)
      && !isWithinParamVarScope(n.parent, context.rulesContext);
    const blockedBySearchScope = context.searchScope.has(n);
    return passesOriginal(n) && !blockedBySearchScope && !blockedParamVar;
  };
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
  const opts: FindOptions = { filter, context, hasTarget, renderKey: context.renderKey };

  if (!target && targetRules.options?.isMixinOutput === true) {
    opts.local = true;
  }

  if (!target && !isInterpolatedVariable && adapter.applyContextualStart) {
    const startIndex = getLookupStartIndex(referenceNode);
    if (startIndex !== undefined) {
      opts.start = startIndex;
      opts.ignoreParentScopeStart = true;
    }
  } else if (resolution === 'live' && !isInterpolatedVariable) {
    if (context.rulesContext !== undefined) {
      opts.start = context.rulesContext.index;
    } else {
      const startIndex = getLookupStartIndex(referenceNode);
      if (startIndex !== undefined) {
        opts.start = startIndex;
      }
    }
  }

  return opts;
}

function lookupRuntimeVarBinding(
  targetRules: Rules,
  key: string,
  context: Context
): RuntimeVarBinding | undefined {
  const frame = targetRules.getScopeFrame();
  let f = frame;
  while (f) {
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
}

const RULES_LOOKUP_ADAPTERS: Record<LookupType, RulesLookupAdapter> = {
  index: {
    applyContextualStart: false,
    lookup(targetRules, valueKey, opts, env) {
      if (typeof valueKey === 'number') {
        return targetRules.at(valueKey);
      }
      const keyStr = getLookupKeyString(valueKey);
      const indexFilterType = isNode(env.keyNode, N.Quoted) ? 'Declaration' as const : 'VarDeclaration' as const;
      return targetRules.find('declaration', keyStr, indexFilterType, opts);
    }
  },
  property: {
    applyContextualStart: true,
    lookup(targetRules, valueKey, opts) {
      return targetRules.find('declaration', getLookupKeyString(valueKey), 'Declaration', opts);
    }
  },
  variable: {
    applyContextualStart: true,
    lookup(targetRules, valueKey, opts, env) {
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
  },
  declaration: {
    applyContextualStart: true,
    lookup(targetRules, valueKey, opts) {
      return targetRules.find('declaration', getLookupKeyString(valueKey), undefined, opts);
    }
  },
  function: {
    applyContextualStart: false,
    lookup(targetRules, valueKey, opts, env) {
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
  },
  mixin: {
    applyContextualStart: false,
    lookup(targetRules, valueKey, opts, env) {
      const callable = targetRules.find('mixin', valueKey, 'Mixin', opts);
      if (callable) {
        return callable;
      }
      if (env.inCall) {
        return targetRules.find('function', getLookupKeyString(valueKey), undefined, opts);
      }
      return undefined;
    }
  },
  ['mixin-ruleset']: {
    applyContextualStart: false,
    lookup(targetRules, valueKey, opts, env) {
      const callable = targetRules.find('mixin', valueKey, undefined, opts);
      if (callable) {
        return callable;
      }
      if (env.inCall) {
        return targetRules.find('function', getLookupKeyString(valueKey), undefined, opts);
      }
      return undefined;
    }
  }
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

  const lookupScopes = context.leakyRules
    ? [resolvedTarget, rulesParent, sourceRulesParent]
    : [resolvedTarget];
  return lookupAcrossRulesScopes(lookupScopes, performRulesLookup);
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
    if (isNode(targetNode, N.JsArray)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return atIndex((targetNode as any).value, valueKey);
    }
    return undefined;
  }
  const keyStr = getLookupKeyString(valueKey);
  if (isNode(targetNode, N.JsObject)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return (targetNode as any).value[keyStr];
  }
  if (isNode(targetNode, N.Rules)) {
    const indexFilterType = isNode(keyNode, N.Quoted) ? 'Declaration' as const : 'VarDeclaration' as const;
    return targetNode.find('declaration', keyStr, indexFilterType);
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

function resolveAmbiguousReferenceTarget(args: {
  referenceNode: Reference;
  resolvedTarget: unknown;
  context: Context;
}): MaybePromise<unknown> {
  const { referenceNode, context, resolvedTarget } = args;

  if (resolvedTarget instanceof Node) {
    if (!(resolvedTarget instanceof MixinCollection) && !isNode(resolvedTarget, N.Rules | N.JsFunction | N.Mixin)) {
      const targetKey = isNode(resolvedTarget, N.Color)
        ? String((resolvedTarget as Color).value.node)
        : resolvedTarget.valueOf();
      if (typeof targetKey === 'string') {
        const refNode = new Reference(targetKey, { type: 'mixin-ruleset' });
        referenceNode.adopt(refNode);
        return refNode.eval(context);
      }
    }
  }

  return resolvedTarget;
}

function materializeReferenceTarget(args: {
  resolvedTarget: unknown;
  valueKey: NormalizedLookupKey;
  context: Context;
}): MaybePromise<[unknown, NormalizedLookupKey]> {
  const { context, valueKey } = args;
  let { resolvedTarget } = args;

  if (resolvedTarget instanceof MixinCollection) {
    return Promise.resolve(resolvedTarget.evalCall(context)).then(r => [r, valueKey]);
  }
  if (isNode(resolvedTarget, N.JsFunction)) {
    const jsResult = resolvedTarget.value.call(context);
    if (isThenable(jsResult)) {
      return Promise.resolve(jsResult).then(result => [result, valueKey]);
    }
    return [jsResult, valueKey];
  }
  if (isNode(resolvedTarget, N.Mixin | N.Ruleset)) {
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
    const out = evald.copy(true, freezeChildren).inherit(evald);
    out.frozen = true;
    out.pre = referenceNode.pre;
    out.post = referenceNode.post;
    out.sourceParent = referenceNode;
    return out;
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

function finalizeDeclarationReferenceResult(
  referenceNode: Reference,
  declaration: Declaration | VarDeclaration,
  context: Context
): MaybePromise<Node> {
  context.searchScope.add(declaration);
  const hasImportant = isNode(declaration, N.Declaration) && !!declaration.value.important;
  const declValue = declaration.value.value;
  const normalizedAssign = isNode(declaration, N.Declaration)
    ? declaration.options?.normalizedFromAssign
    : undefined;
  const isMergedAssign = normalizedAssign === '+:' || normalizedAssign === '&,:' || normalizedAssign === '&_:';
  const isMixinRef = isNode(declValue, N.Reference) && declValue.options?.type === 'mixin-ruleset';
  return pipe(
    () => {
      if (hasImportant) {
        context.pushImportantSource();
      }
      declValue.frozen = true;
      if (isMixinRef) {
        return declValue;
      }
      return declValue.eval(context);
    },
    (evald) => {
      context.searchScope.delete(declaration);
      let out: Node = evald.copy(true, freezeChildren).inherit(evald);
      if (isMergedAssign && isNode(out, N.List)) {
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
        collect(out);
        if (mergedItems.length === 0) {
          out = new Nil();
        } else if (mergedItems.length === 1) {
          out = mergedItems[0]!;
        } else {
          out = new List(mergedItems);
        }
      }
      out.frozen = true;
      out.pre = referenceNode.pre;
      out.post = referenceNode.post;
      out.sourceParent = referenceNode;
      return out;
    }
  );
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
  const valueKeyStr = getLookupKeyDisplay(valueKey);

  if (returnVal === undefined) {
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

  if (isRuntimeVarBinding(returnVal)) {
    return finalizeRuntimeVarBindingResult(referenceNode, returnVal, context);
  }

  if (isNode(returnVal, N.Declaration | N.VarDeclaration)) {
    return finalizeDeclarationReferenceResult(referenceNode, returnVal, context);
  }

  if (isArray(returnVal)) {
    for (const item of returnVal) {
      item.sourceParent = referenceNode;
      if (!isNode(item, N.Mixin | N.Ruleset)) {
        return cast(undefined);
      }
    }
    return new MixinCollection(returnVal as MixinEntry[]);
  }

  const result = cast(returnVal);
  context.popReference();
  result.sourceParent = referenceNode;
  return result;
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
    // Track reference chain for clearing remainders at outermost level
    context.pushReference();
    // Prefer the *current* evaluation rules context (mixin live scope) over the lexical rulesParent.
    // This is critical for mixin parameters (e.g. `@fallback`) which are registered onto the live
    // wrapper `Rules` and should be visible inside nested at-rule preludes.
    let resolvedTarget = target ? target.eval(context) : context.rulesContext ?? this.rulesParent;
    const result = pipe(
      () => {
        if (isThenable(resolvedTarget)) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          return (resolvedTarget as Promise<any>).then(result => result);
        }
        return resolvedTarget;
      },
      resolved => evaluateReferenceKey(key, resolved, context),
      ([resolvedTarget, valueKey]) => resolveReferenceTargetValue({
        referenceNode: this,
        resolvedTarget,
        valueKey,
        context
      }),
      ([resolvedTarget, valueKey]) => {
        const isInterpolatedVariable =
          lookupType === 'variable'
          && this.parent?.type === 'Interpolated';
        const filter = buildReferenceFilter(originalFilter, context);
        const hasTarget = !!target;
        const adapter = RULES_LOOKUP_ADAPTERS[lookupType];
        const lookupEnv: RulesLookupAdapterEnv = {
          context,
          keyNode: this.value.key,
          hasTarget,
          inCall: isNode(this.parent, N.Call),
          isInterpolatedVariable,
          filter
        };

        const performLookup = (scope: Rules): RulesLookupResult => {
          const opts = buildReferenceLookupOptions({
            referenceNode: this,
            target,
            targetRules: scope,
            resolution: this.options.resolution,
            isInterpolatedVariable,
            filter,
            context,
            hasTarget,
            adapter
          });
          return adapter.lookup(scope, valueKey as NormalizedLookupKey, opts, lookupEnv);
        };

        const returnVal = lookupReferenceTarget({
          resolvedTarget,
          lookupType,
          valueKey: valueKey as NormalizedLookupKey,
          keyNode: this.value.key,
          context,
          rulesParent: this.rulesParent,
          sourceRulesParent: this.sourceRulesParent,
          performRulesLookup: performLookup
        });
        if (isThenable(returnVal)) {
          return Promise.resolve(returnVal).then(resolved => ({
            returnVal: resolved,
            valueKey
          }));
        }
        return { returnVal, valueKey };
      },
      ({ returnVal, valueKey }) => finalizeReferenceLookupResult({
        referenceNode: this,
        returnVal,
        valueKey: valueKey as NormalizedLookupKey,
        lookupType,
        fallbackValue,
        context
      })
    );
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
