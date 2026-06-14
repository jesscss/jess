import { defineType, Node, F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC, F_STATIC, type LocationInfo } from './node.js';
import type { Context } from '../context.js';
import { cast } from './util/cast.js';
import type { CallableFindOptions, DeclarationFindOptions } from './util/lookup-utils.js';
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
import type { Rules, RuntimeVarBinding } from './rules.js';
import type { Interpolated } from './interpolated.js';
import { copyWithReusableLeaves } from './util/cloning.js';
import type { Declaration } from './declaration.js';
import type { Color } from './color.js';
import { JsArray } from './js-array.js';
import { JsObject } from './js-object.js';
import { JsExpression } from './js-expr.js';
import { List } from './list.js';
import { Nil } from './nil.js';
import {
  getBindingCellValue,
  lookupScopeFrameVariable,
  setScopeFrameDeclarationBinding,
  type BindingEntry,
  type ScopeFrame
} from './scope-frame.js';
import type { VarDeclaration } from './declaration-var.js';
import { getOrderedSelectorKeys } from './util/lookup-utils.js';
import {
  isRenderBuffer,
  writeRenderTextResult,
  type RenderBuffer
} from './util/render-buffer.js';
import { blocksAmbientMixinOutputLookup } from './util/mixin-output-slot.js';
import { MixinCollection } from './util/callable-collection.js';
import type { MixinEntry } from './util/callable-entry.js';
import {
  DIRECT_DECLARATION_LOOKUP_UNCOVERED,
  findAnyDeclaration,
  findPropertyDeclaration,
  findVariableDeclaration
} from './util/direct-rules-lookup.js';
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
  /** Internal call-site hint: terminal mixin-ruleset lookup cannot use rulesets when args are present. */
  mixinRulesetCallHasArgs?: boolean;
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

const REF_EVAL_PRESERVE_RULES_LIKE = 1;
const REF_EVAL_REUSE_SOURCE_FREE = 1 << 1;

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
      const entry: BindingEntry = {
        cell: {
          value: decl.value.value,
          sourceNode: decl,
          readonly: decl.options?.readonly
        },
        sourceNode: decl
      };
      bucket.push(entry);
      setScopeFrameDeclarationBinding(frame, resolvedName, entry);
    } else {
      const currentEntry = bucket[bucket.length - 1];
      if (currentEntry) {
        setScopeFrameDeclarationBinding(frame, resolvedName, currentEntry);
      }
    }
    mutated = true;
  }

  if (mutated) {
    frame.pendingDeclarationNames = remaining;
    scope.directDeclarationsByName = undefined;
    scope.directDeclarationLookupCache = undefined;
    scope.lookupVersion++;
  }
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
const SCOPE_FRAME_VARIABLE_MISS = Symbol('scope-frame-variable-miss');
type ScopeFrameVariableBindingResult = RuntimeVarBinding | typeof SCOPE_FRAME_VARIABLE_MISS | undefined;
type RulesLookupHandleReadResult = RulesLookupResult | typeof SCOPE_FRAME_VARIABLE_MISS;

type ReferenceRulesLookupHandle = {
  targetRules: Rules;
  targetLookupVersion: number;
  valueKey: string | string[];
  lookupType: 'declaration' | 'function' | 'mixin' | 'mixin-ruleset' | 'property';
  inCall: boolean;
  start: number | undefined;
  local: boolean;
  ignoreParentScopeStart: boolean;
  terminalMixinOnly: boolean;
  returnVal: RulesLookupResult;
};

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
  semanticFilter: boolean;
};

type RulesLookupAdapter = {
  applyContextualStart: boolean;
  lookup: (
    targetRules: Rules,
    valueKey: NormalizedLookupKey,
    opts: ReferenceLookupOptions,
    env: RulesLookupAdapterEnv
  ) => RulesLookupResult;
};

type RulesReferenceLookupContext = {
  referenceNode: Reference;
  target: ReferenceValue['target'];
  resolution: ReferenceOptions['resolution'];
  isInterpolatedVariable: boolean;
  filter: (n: Node) => boolean;
  semanticFilter: boolean;
  context: Context;
  hasTarget: boolean;
  adapter: RulesLookupAdapter;
  valueKey: NormalizedLookupKey;
  env: RulesLookupAdapterEnv;
};

type PreparedReferenceLookup = {
  adapter: RulesLookupAdapter;
  env: RulesLookupAdapterEnv;
};

type ReferenceLookupOptions = {
  declaration: DeclarationFindOptions & { context: Context };
  callable: CallableFindOptions;
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

function isStringArray(value: unknown[]): value is string[] {
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string') {
      return false;
    }
  }
  return true;
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
  semanticFilter: boolean;
  context: Context;
  hasTarget: boolean;
  adapter: RulesLookupAdapter;
}): ReferenceLookupOptions {
  const {
    referenceNode,
    target,
    targetRules,
    resolution,
    isInterpolatedVariable,
    filter,
    semanticFilter,
    context,
    hasTarget,
    adapter
  } = args;
  const local = shouldUseLocalReferenceLookup({ target, targetRules }) || undefined;
  let start: number | undefined;
  let ignoreParentScopeStart: true | undefined;

  if (!isInterpolatedVariable) {
    if (resolution === 'live') {
      start = context.rulesContext?.index ?? getLookupStartIndex(referenceNode);
    } else if (!target && adapter.applyContextualStart) {
      start = getLookupStartIndex(referenceNode) ?? (
        referenceNode.options.type === 'variable' || referenceNode.options.type === undefined
          ? undefined
          : context.rulesContext?.index
      );
      if (
        start !== undefined
        && (referenceNode.options.type === 'variable' || referenceNode.options.type === undefined)
      ) {
        ignoreParentScopeStart = true;
      }
    }
  }

  return {
    declaration: {
      filter,
      semanticFilter,
      context,
      hasTarget,
      local,
      start,
      ignoreParentScopeStart
    },
    callable: {
      context,
      hasTarget,
      local,
      terminalMixinOnly: referenceNode.options.mixinRulesetCallHasArgs === true || undefined
    }
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
  const semanticFilter = originalFilter !== undefined;
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
      filter,
      semanticFilter
    }
  };
}

function lookupScopeFrameVariableBinding(
  targetRules: Rules,
  key: string,
  opts: DeclarationFindOptions,
  env: RulesLookupAdapterEnv
): ScopeFrameVariableBindingResult {
  if (
    env.hasTarget
    || env.isInterpolatedVariable
    || (opts.start !== undefined && env.readMode !== 'snapshot')
  ) {
    return undefined;
  }
  const frame = targetRules.getScopeFrame();
  promoteResolvedPendingVarDecls(targetRules, frame);
  const hit = lookupScopeFrameVariable(frame, key, {
    start: opts.start,
    filter: env.filter,
    blockedSource: node => env.context.searchScope.has(node),
    includeLive: env.readMode !== 'snapshot',
    bailOnPendingDeclarations: true
  });
  if (hit.kind === 'uncovered') {
    return undefined;
  }
  if (hit.kind === 'miss') {
    return SCOPE_FRAME_VARIABLE_MISS;
  }
  const cell = hit.kind === 'declaration' ? hit.entry.cell : hit.cell;
  const sourceNode = hit.kind === 'declaration' ? hit.entry.sourceNode : hit.sourceNode;
  const value = getBindingCellValue(cell);
  return {
    kind: 'runtime-var-binding',
    value,
    readonly: cell.readonly,
    sourceNode,
    rulesContext: isNode(cell.rulesContext, N.Rules) ? cell.rulesContext : undefined
  } satisfies RuntimeVarBinding;
}

function lookupLiveScopeFrameVariableBinding(
  targetRules: Rules,
  key: string,
  context: Context
): RuntimeVarBinding | undefined {
  const hit = lookupScopeFrameVariable(targetRules.getScopeFrame(), key, {
    blockedSource: node => context.searchScope.has(node),
    includeDeclarations: false
  });
  if (hit.kind !== 'live') {
    return undefined;
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
  opts: ReferenceLookupOptions,
  env: RulesLookupAdapterEnv
): RulesLookupResult {
  if (typeof valueKey === 'number') {
    return targetRules.at(valueKey);
  }
  if (!isNode(env.keyNode, N.Quoted)) {
    const live = lookupLiveScopeFrameVariableBinding(targetRules, getLookupKeyString(valueKey), env.context);
    if (live) {
      return live;
    }
  }
  const keyStr = getLookupKeyString(valueKey);
  return isNode(env.keyNode, N.Quoted)
    ? lookupPropertyDeclarationOrFind(targetRules, keyStr, opts.declaration)
    : lookupVariableDeclarationOrFind(targetRules, keyStr, opts.declaration);
}

function lookupPropertyReference(
  targetRules: Rules,
  valueKey: NormalizedLookupKey,
  opts: ReferenceLookupOptions,
  _env: RulesLookupAdapterEnv
): RulesLookupResult {
  return lookupPropertyDeclarationOrFind(targetRules, getLookupKeyString(valueKey), opts.declaration);
}

function lookupVariableReference(
  targetRules: Rules,
  valueKey: NormalizedLookupKey,
  opts: ReferenceLookupOptions,
  env: RulesLookupAdapterEnv
): RulesLookupResult {
  const keyStr = getLookupKeyString(valueKey);
  if (typeof valueKey === 'string') {
    const frameHit = lookupScopeFrameVariableBinding(targetRules, keyStr, opts.declaration, env);
    if (frameHit) {
      if (frameHit === SCOPE_FRAME_VARIABLE_MISS) {
        if (env.readMode !== 'snapshot') {
          return undefined;
        }
      } else {
        return frameHit;
      }
    }
  }
  if (env.readMode !== 'snapshot') {
    const live = lookupLiveScopeFrameVariableBinding(targetRules, keyStr, env.context);
    if (live) {
      return live;
    }
  }
  const direct = findVariableDeclaration(targetRules, keyStr, {
    start: opts.declaration.start,
    context: env.context,
    hasTarget: env.hasTarget,
    local: opts.declaration.local,
    filter: env.filter,
    includeLiveBindings: env.readMode !== 'snapshot',
    ignoreCurrentScopeStart: true,
    ignoreParentScopeStart: opts.declaration.ignoreParentScopeStart === true
  });
  return direct === DIRECT_DECLARATION_LOOKUP_UNCOVERED ? undefined : direct;
}

function lookupDeclarationReference(
  targetRules: Rules,
  valueKey: NormalizedLookupKey,
  opts: ReferenceLookupOptions,
  _env: RulesLookupAdapterEnv
): RulesLookupResult {
  return lookupAnyDeclarationOrFind(targetRules, getLookupKeyString(valueKey), opts.declaration);
}

function lookupFunctionReference(
  targetRules: Rules,
  valueKey: NormalizedLookupKey,
  opts: ReferenceLookupOptions,
  env: RulesLookupAdapterEnv
): RulesLookupResult {
  const keyStr = getLookupKeyString(valueKey);
  if (env.inCall) {
    return (
      targetRules.findFunction(keyStr, undefined, opts.callable)
      ?? lookupAnyDeclarationOrFind(targetRules, keyStr, opts.declaration)
    );
  }
  return (
    lookupAnyDeclarationOrFind(targetRules, keyStr, opts.declaration)
    ?? targetRules.findFunction(keyStr, undefined, opts.callable)
  );
}

function lookupVariableDeclarationOrFind(
  targetRules: Rules,
  key: string,
  opts: DeclarationFindOptions
): RulesLookupResult {
  const direct = findVariableDeclaration(targetRules, key, opts);
  return direct === DIRECT_DECLARATION_LOOKUP_UNCOVERED ? undefined : direct;
}

function lookupPropertyDeclarationOrFind(
  targetRules: Rules,
  key: string,
  opts: DeclarationFindOptions
): RulesLookupResult {
  const direct = findPropertyDeclaration(targetRules, key, opts);
  return direct === DIRECT_DECLARATION_LOOKUP_UNCOVERED ? undefined : direct;
}

function lookupAnyDeclarationOrFind(
  targetRules: Rules,
  key: string,
  opts: DeclarationFindOptions
): RulesLookupResult {
  const direct = findAnyDeclaration(targetRules, key, opts);
  return direct === DIRECT_DECLARATION_LOOKUP_UNCOVERED ? undefined : direct;
}

function lookupCallableReference(
  targetRules: Rules,
  valueKey: NormalizedLookupKey,
  opts: ReferenceLookupOptions,
  env: RulesLookupAdapterEnv,
  filterType?: 'Mixin'
): RulesLookupResult {
  const callableKey = Array.isArray(valueKey) ? valueKey : getLookupKeyString(valueKey);
  const callable = targetRules.findMixin(callableKey, filterType, opts.callable);
  if (callable) {
    return callable;
  }
  if (env.inCall) {
    return targetRules.findFunction(getLookupKeyString(valueKey), undefined, opts.callable);
  }
  return undefined;
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
  lookupContext: RulesReferenceLookupContext;
}): MaybePromise<RulesLookupResult> {
  const first = performRulesReferenceLookup(args.resolvedTarget, args.lookupContext);
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
  lookupContext: RulesReferenceLookupContext;
}): MaybePromise<RulesLookupResult> {
  const rulesParent = args.rulesParent;
  if (isNode(rulesParent, N.Rules)) {
    const result = performRulesReferenceLookup(rulesParent, args.lookupContext);
    if (isThenable(result)) {
      return Promise.resolve(result).then((resolved) => {
        if (isRulesLookupResult(resolved)) {
          return resolved;
        }
        const sourceRulesParent = args.sourceRulesParent;
        return isNode(sourceRulesParent, N.Rules)
          ? performRulesReferenceLookup(sourceRulesParent, args.lookupContext)
          : undefined;
      });
    }
    if (result !== undefined) {
      return result;
    }
  }

  const sourceRulesParent = args.sourceRulesParent;
  return isNode(sourceRulesParent, N.Rules)
    ? performRulesReferenceLookup(sourceRulesParent, args.lookupContext)
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
  lookupContext: RulesReferenceLookupContext;
}): MaybePromise<RulesLookupResult> {
  const {
    resolvedTarget,
    lookupType,
    valueKey,
    keyNode,
    context,
    rulesParent,
    sourceRulesParent,
    lookupContext
  } = args;

  if (!isNode(resolvedTarget, N.Rules)) {
    return lookupDirectTarget(resolvedTarget, lookupType, valueKey, keyNode);
  }

  return lookupRulesReferenceTarget({
    resolvedTarget,
    context,
    rulesParent,
    sourceRulesParent,
    lookupContext
  });
}

function performRulesReferenceLookup(
  scope: Rules,
  lookupContext: RulesReferenceLookupContext
): RulesLookupResult {
  const {
    referenceNode,
    target,
    resolution,
    isInterpolatedVariable,
    filter,
    semanticFilter,
    context,
    hasTarget,
    adapter,
    valueKey,
    env
  } = lookupContext;
  const opts = buildReferenceLookupOptions({
    referenceNode,
    target,
    targetRules: scope,
    resolution,
    isInterpolatedVariable,
    filter,
    semanticFilter,
    context,
    hasTarget,
    adapter
  });
  return adapter.lookup(scope, valueKey, opts, env);
}

function isHandleableLookupKey(valueKey: NormalizedLookupKey): valueKey is string | string[] {
  return typeof valueKey === 'string' || Array.isArray(valueKey);
}

function canUseRulesLookupHandle(args: {
  lookupType: LookupType;
  valueKey: NormalizedLookupKey;
  target: ReferenceValue['target'];
  originalFilter: ReferenceOptions['filter'] | undefined;
  env: RulesLookupAdapterEnv;
  context: Context;
}): args is typeof args & {
  lookupType: 'declaration' | 'function' | 'mixin' | 'mixin-ruleset' | 'property';
  valueKey: string | string[];
} {
  const handleableKey = (
    args.lookupType === 'declaration'
    || args.lookupType === 'function'
    || args.lookupType === 'property'
  )
    ? typeof args.valueKey === 'string'
    : isHandleableLookupKey(args.valueKey);
  return (
    (
      args.lookupType === 'declaration'
      || args.lookupType === 'function'
      || args.lookupType === 'mixin'
      || args.lookupType === 'mixin-ruleset'
      || args.lookupType === 'property'
    )
    && handleableKey
    && args.target === undefined
    && args.originalFilter === undefined
    && !args.env.semanticFilter
    && !args.env.hasTarget
    && !args.env.isInterpolatedVariable
    && args.context.leakyRules !== true
    && args.context.searchScope.size === 0
  );
}

type RulesLookupHandleShape = {
  start: number | undefined;
  local: boolean;
  ignoreParentScopeStart: boolean;
  terminalMixinOnly: boolean;
};

function getRulesLookupHandleShape(args: {
  targetRules: Rules;
  lookupContext: RulesReferenceLookupContext;
}): RulesLookupHandleShape {
  const opts = buildReferenceLookupOptions({
    referenceNode: args.lookupContext.referenceNode,
    target: args.lookupContext.target,
    targetRules: args.targetRules,
    resolution: args.lookupContext.resolution,
    isInterpolatedVariable: args.lookupContext.isInterpolatedVariable,
    filter: args.lookupContext.filter,
    semanticFilter: args.lookupContext.semanticFilter,
    context: args.lookupContext.context,
    hasTarget: args.lookupContext.hasTarget,
    adapter: args.lookupContext.adapter
  });
  return {
    start: opts.declaration.start,
    local: opts.declaration.local === true,
    ignoreParentScopeStart: opts.declaration.ignoreParentScopeStart === true,
    terminalMixinOnly: opts.callable.terminalMixinOnly === true
  };
}

function readRulesLookupHandle(args: {
  referenceNode: Reference;
  targetRules: Rules;
  lookupType: LookupType;
  valueKey: NormalizedLookupKey;
  target: ReferenceValue['target'];
  originalFilter: ReferenceOptions['filter'] | undefined;
  env: RulesLookupAdapterEnv;
  context: Context;
  shape: RulesLookupHandleShape;
}): RulesLookupHandleReadResult {
  if (!canUseRulesLookupHandle(args)) {
    return undefined;
  }
  const handle = args.referenceNode._rulesLookupHandle;
  if (
    !handle
    || handle.targetRules !== args.targetRules
    || handle.targetLookupVersion !== args.targetRules.lookupVersion
    || handle.lookupType !== args.lookupType
    || handle.inCall !== args.env.inCall
    || handle.start !== args.shape.start
    || handle.local !== args.shape.local
    || handle.ignoreParentScopeStart !== args.shape.ignoreParentScopeStart
    || handle.terminalMixinOnly !== args.shape.terminalMixinOnly
    || handle.valueKey !== args.valueKey
  ) {
    return undefined;
  }
  return handle.returnVal ?? SCOPE_FRAME_VARIABLE_MISS;
}

function writeRulesLookupHandle(args: {
  referenceNode: Reference;
  targetRules: Rules;
  lookupType: LookupType;
  valueKey: NormalizedLookupKey;
  target: ReferenceValue['target'];
  originalFilter: ReferenceOptions['filter'] | undefined;
  env: RulesLookupAdapterEnv;
  context: Context;
  shape: RulesLookupHandleShape;
  returnVal: RulesLookupResult;
}): void {
  if (!canUseRulesLookupHandle(args)) {
    args.referenceNode._rulesLookupHandle = undefined;
    return;
  }
  args.referenceNode._rulesLookupHandle = {
    targetRules: args.targetRules,
    targetLookupVersion: args.targetRules.lookupVersion,
    valueKey: args.valueKey,
    lookupType: args.lookupType,
    inCall: args.env.inCall,
    start: args.shape.start,
    local: args.shape.local,
    ignoreParentScopeStart: args.shape.ignoreParentScopeStart,
    terminalMixinOnly: args.shape.terminalMixinOnly,
    returnVal: args.returnVal
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

  const lookupContext: RulesReferenceLookupContext = {
    referenceNode,
    target,
    resolution: referenceNode.options.resolution,
    isInterpolatedVariable: env.isInterpolatedVariable,
    filter: env.filter,
    semanticFilter: env.semanticFilter,
    context,
    hasTarget: env.hasTarget,
    adapter,
    valueKey,
    env
  };

  const targetRules = isNode(resolvedTarget, N.Rules) ? resolvedTarget : undefined;
  let handleShape: RulesLookupHandleShape | undefined;
  if (targetRules) {
    handleShape = getRulesLookupHandleShape({
      targetRules,
      lookupContext
    });
    const handleResult = readRulesLookupHandle({
      referenceNode,
      targetRules,
      lookupType,
      valueKey,
      target,
      originalFilter,
      env,
      context,
      shape: handleShape
    });
    if (handleResult !== undefined) {
      return {
        returnVal: handleResult === SCOPE_FRAME_VARIABLE_MISS ? undefined : handleResult,
        valueKey
      };
    }
  }

  const returnVal = lookupReferenceTarget({
    resolvedTarget: isNode(resolvedTarget) ? resolvedTarget : undefined,
    lookupType,
    valueKey,
    keyNode: referenceNode.value.key,
    context,
    rulesParent: referenceNode.rulesParent,
    sourceRulesParent: referenceNode.sourceRulesParent,
    lookupContext
  });

  if (isThenable(returnVal)) {
    return Promise.resolve(returnVal).then((resolved) => {
      if (targetRules) {
        writeRulesLookupHandle({
          referenceNode,
          targetRules,
          lookupType,
          valueKey,
          target,
          originalFilter,
          env,
          context,
          shape: handleShape ?? getRulesLookupHandleShape({ targetRules, lookupContext }),
          returnVal: resolved
        });
      }
      return {
        returnVal: resolved,
        valueKey
      };
    });
  }
  if (targetRules) {
    writeRulesLookupHandle({
      referenceNode,
      targetRules,
      lookupType,
      valueKey,
      target,
      originalFilter,
      env,
      context,
      shape: handleShape ?? getRulesLookupHandleShape({ targetRules, lookupContext }),
      returnVal
    });
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

function lookupDirectRulesTarget(
  targetNode: Rules,
  key: string,
  keyNode: ReferenceValue['key']
): RulesLookupResult {
  return isNode(keyNode, N.Quoted)
    ? lookupPropertyDeclarationOrFind(targetNode, key, {})
    : lookupVariableDeclarationOrFind(targetNode, key, {});
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
      if (isStringArray(resolvedKey)) {
        return [resolvedTarget, resolvedKey];
      }
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
    && runtimeRulesParent?._scopeFrame?.liveSlotsByName.has(runtimeLiveSlotKey);
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
    if (isThenable(mixinResult)) {
      return Promise.resolve(mixinResult).then(rules => [rules, valueKey]);
    }
    return [mixinResult, valueKey];
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
  fallbackValue: Node,
  context: Context,
  textOnly = false
): MaybePromise<Node> {
  if (canReturnReferenceValue(fallbackValue)) {
    context.popReference();
    return fallbackValue;
  }
  if (textOnly && isNode(fallbackValue, N.List | N.Sequence)) {
    context.popReference();
    return fallbackValue;
  }
  if (textOnly && fallbackValue instanceof JsExpression) {
    context.popReference();
    return fallbackValue;
  }
  if (fallbackValue instanceof JsExpression) {
    const out = fallbackValue.resolve(context);
    if (isThenable(out)) {
      return Promise.resolve(out).finally(() => {
        context.popReference();
      });
    }
    context.popReference();
    return out;
  }
  const out = fallbackValue.eval(context);
  if (isThenable(out)) {
    return Promise.resolve(out).finally(() => {
      context.popReference();
    });
  }
  context.popReference();
  return out;
}

function finalizeFallbackReferenceResult(
  referenceNode: Reference,
  valueKey: NormalizedLookupKey,
  lookupType: LookupType,
  fallbackValue: ReferenceOptions['fallbackValue'],
  context: Context,
  textOnly: boolean
): MaybePromise<Node> {
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
  return evaluateFallbackValue(fallbackValue, context, textOnly);
}

function finalizeDirectReferenceResult(
  referenceNode: Reference,
  returnVal: unknown,
  context: Context
): Node {
  if (isArray(returnVal)) {
    context.popReference();
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
  context: Context
): Node {
  context.popReference();
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
  context: Context
): MaybePromise<Node> {
  const bindingSource = binding.sourceNode;
  const finalizeRuntimeBinding = (evald: Node) => {
    if (
      referenceNode.options?.preserveRulesLike === true
      && isRulesLikeReferenceValue(evald)
    ) {
      return (
        isNode(bindingSource, N.VarDeclaration)
        && !bindingSource.options?.paramVar
        && evald.sourceNode === undefined
      )
        ? createRulesLikeReferenceSurface(evald)
        : evald;
    }
    return evald;
  };
  const shouldUseDefinitionRulesContext = isNode(bindingSource, N.VarDeclaration) && (
    bindingSource.options?.paramVar
    || (
      context.leakyRules !== true
      && isNode(binding.value, N.Rules | N.Collection)
    )
  );

  let evalFlags = REF_EVAL_REUSE_SOURCE_FREE;
  if (
    referenceNode.options?.type === 'mixin-ruleset'
    || (
      referenceNode.options?.preserveRulesLike === true
      && isNode(bindingSource, N.VarDeclaration)
      && !bindingSource.options?.paramVar
    )
  ) {
    evalFlags |= REF_EVAL_PRESERVE_RULES_LIKE;
  }
  const evaluatedBinding = evaluateRuntimeVarBindingValue(
    binding,
    bindingSource,
    context,
    evalFlags,
    shouldUseDefinitionRulesContext
  );

  if (isThenable(evaluatedBinding)) {
    return Promise.resolve(evaluatedBinding)
      .then(finalizeRuntimeBinding)
      .finally(() => {
        context.popReference();
      });
  }
  try {
    return finalizeRuntimeBinding(evaluatedBinding);
  } finally {
    context.popReference();
  }
}

function evaluateRuntimeVarBindingValue(
  binding: RuntimeVarBinding,
  bindingSource: RuntimeVarBinding['sourceNode'],
  context: Context,
  evalFlags: number,
  useDefinitionRulesContext: boolean
): MaybePromise<Node> {
  const savedRulesContext = context.rulesContext;
  let changedRulesContext = false;
  if (useDefinitionRulesContext && bindingSource) {
    context.rulesContext = binding.rulesContext ?? bindingSource.rulesParent ?? context.rulesContext;
    changedRulesContext = true;
  }
  if (bindingSource) {
    context.searchScope.add(bindingSource);
  }

  try {
    const result = evaluateReferenceValueNode(binding.value, context, evalFlags);
    if (isThenable(result)) {
      return Promise.resolve(result).finally(() => {
        if (bindingSource) {
          context.searchScope.delete(bindingSource);
        }
        if (changedRulesContext) {
          context.rulesContext = savedRulesContext;
        }
      });
    }
    if (bindingSource) {
      context.searchScope.delete(bindingSource);
    }
    if (changedRulesContext) {
      context.rulesContext = savedRulesContext;
    }
    return result;
  } catch (error) {
    if (bindingSource) {
      context.searchScope.delete(bindingSource);
    }
    if (changedRulesContext) {
      context.rulesContext = savedRulesContext;
    }
    throw error;
  }
}

function finalizeDeclarationReferenceResult(
  referenceNode: Reference,
  declaration: Declaration | VarDeclaration,
  context: Context
): MaybePromise<Node> {
  const declarationValue = declaration.value.value;
  let isMergedAssign = false;
  let hasImportant = false;
  if (isNode(declaration, N.Declaration)) {
    hasImportant = !!declaration.value.important;
    const normalizedAssign = declaration.options?.normalizedFromAssign;
    isMergedAssign = normalizedAssign === '+:' || normalizedAssign === '&,:' || normalizedAssign === '&_:';
  }
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
  context.searchScope.add(declaration);
  let referencePopped = false;
  let importantPushed = false;
  const popReference = () => {
    if (!referencePopped) {
      context.popReference();
      referencePopped = true;
    }
  };
  try {
    if (hasImportant) {
      context.pushImportantSource();
      importantPushed = true;
    }
    const evaluated = evaluateReferenceValueNode(declarationValue, context);
    const finalize = (evaluatedNode: Node): Node => {
      if (!isMergedAssign) {
        popReference();
        return evaluatedNode;
      }
      const normalized = normalizeMergedAssignReferenceResult(evaluatedNode);
      const finalized = normalized.inherit(referenceNode);
      popReference();
      return finalized;
    };
    if (isThenable(evaluated)) {
      return Promise.resolve(evaluated)
        .then(finalize)
        .catch((error) => {
          popReference();
          if (importantPushed) {
            context.popImportantSource();
            importantPushed = false;
          }
          throw error;
        })
        .finally(() => {
          context.searchScope.delete(declaration);
        });
    }
    const finalized = finalize(evaluated);
    context.searchScope.delete(declaration);
    return finalized;
  } catch (error) {
    popReference();
    if (importantPushed) {
      context.popImportantSource();
      importantPushed = false;
    }
    context.searchScope.delete(declaration);
    throw error;
  }
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
  flags = 0
): MaybePromise<Node> {
  if (
    (flags & REF_EVAL_PRESERVE_RULES_LIKE) !== 0
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
      (flags & REF_EVAL_REUSE_SOURCE_FREE) !== 0
      && canReturnReferenceValue(declValue)
    ) {
      return declValue;
    }
    return copyWithReusableLeaves(declValue).eval(context);
  } finally {
    context.calcFrames = savedCalcFrames;
  }
}

function normalizeMergedAssignReferenceResult(node: Node): Node {
  if (!(node instanceof List)) {
    return node;
  }
  let mergedItems: Node[] | undefined;
  const collect = (child: Node): void => {
    if (child instanceof List) {
      for (const item of child.value) {
        collect(item);
      }
      return;
    }
    const isEmptyPlaceholder = (
      child instanceof Nil
      || String(child.valueOf?.() ?? '') === ''
    );
    if (!isEmptyPlaceholder) {
      mergedItems!.push(child);
    }
  };

  for (let i = 0; i < node.value.length; i++) {
    const child = node.value[i]!;
    const needsNormalization = (
      child instanceof List
      || child instanceof Nil
      || String(child.valueOf?.() ?? '') === ''
    );
    if (!needsNormalization) {
      if (mergedItems) {
        mergedItems.push(child);
      }
      continue;
    }
    if (!mergedItems) {
      mergedItems = [];
      for (let j = 0; j < i; j++) {
        mergedItems.push(node.value[j]!);
      }
    }
    collect(child);
  }
  if (!mergedItems) {
    return node;
  }
  if (mergedItems.length === 0) {
    return new Nil();
  }
  if (mergedItems.length === 1) {
    return mergedItems[0]!;
  }
  return new List(mergedItems);
}

function finalizeReferenceLookupResult(
  referenceNode: Reference,
  returnVal: RulesLookupResult | unknown,
  valueKey: NormalizedLookupKey,
  lookupType: LookupType,
  fallbackValue: ReferenceOptions['fallbackValue'],
  context: Context,
  textOnly = false
): MaybePromise<Node> {
  if (returnVal === undefined) {
    return finalizeFallbackReferenceResult(
      referenceNode,
      valueKey,
      lookupType,
      fallbackValue,
      context,
      textOnly
    );
  }
  if (isRuntimeVarBinding(returnVal)) {
    return finalizeRuntimeVarBindingResult(referenceNode, returnVal, context);
  }
  if (isNode(returnVal, N.Declaration) || isNode(returnVal, N.VarDeclaration)) {
    return finalizeDeclarationReferenceResult(referenceNode, returnVal, context);
  }
  return finalizeDirectReferenceResult(referenceNode, returnVal, context);
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
      .then(({ returnVal }) => finalizeRawReferenceLookupTarget(returnVal))
      .finally(() => {
        context.popReference();
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
      .then(({ returnVal }) => finalizeRawReferenceLookupTarget(returnVal))
      .finally(() => {
        context.popReference();
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
      .then(({ returnVal }) => finalizeRawReferenceLookupTarget(returnVal))
      .finally(() => {
        context.popReference();
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
      .then(({ returnVal }) => finalizeRawReferenceLookupTarget(returnVal))
      .finally(() => {
        context.popReference();
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
    || !canReturnReferenceValue(target)
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
  const renderTextOnly = textOnly === true;
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
        return finalizeReferenceLookupResult(
          referenceNode,
          returnVal,
          valueKey,
          lookupType,
          fallbackValue,
          context,
          renderTextOnly
        );
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
        return finalizeReferenceLookupResult(
          referenceNode,
          returnVal,
          valueKey,
          lookupType,
          fallbackValue,
          context,
          renderTextOnly
        );
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
        return finalizeReferenceLookupResult(
          referenceNode,
          returnVal,
          valueKey,
          lookupType,
          fallbackValue,
          context,
          renderTextOnly
        );
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
        return finalizeReferenceLookupResult(
          referenceNode,
          returnVal,
          valueKey,
          lookupType,
          fallbackValue,
          context,
          renderTextOnly
        );
      });
  }

  const directRenderValue = directStaticRender === true
    ? finalizeDirectRawRenderValue(referenceNode, lookup.returnVal, context)
    : undefined;
  if (directRenderValue) {
    return directRenderValue;
  }
  return finalizeReferenceLookupResult(
    referenceNode,
    lookup.returnVal,
    lookup.valueKey,
    lookupType,
    fallbackValue,
    context,
    renderTextOnly
  );
}

/**
 * This is a variable or property reference,
 * which can itself contain a reference (a variable variable).
 */
export class Reference extends Node<ReferenceValue, ReferenceOptions> {
  _rulesLookupHandle: ReferenceRulesLookupHandle | undefined;

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
