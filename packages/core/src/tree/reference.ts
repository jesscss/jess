import { defineType, Node, F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC, F_STATIC } from './node.js';
import type { Context } from '../context.js';
import { cast } from './util/cast.js';
import type { DeclarationFindOptions } from './util/lookup-utils.js';
import { Any, type AnyRole } from './any.js';
import { Selector } from './selector.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import type { Call } from './call.js';
import type { Quoted } from './quoted.js';
import { atIndex } from './util/collections.js';
import type { Num } from './number.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import type { Rules } from './rules.js';
import type { Interpolated } from './interpolated.js';
import { copyWithReusableLeaves } from './util/cloning.js';
import type { Declaration } from './declaration.js';
import type { Color } from './color.js';
import { JsArray } from './js-array.js';
import { JsObject } from './js-object.js';
import { List } from './list.js';
import { Nil } from './nil.js';
import {
  getBindingCellValue,
  createVarDeclarationBindingEntry,
  ensureBindingCellLookupIdentity,
  lookupScopeFrameVariable,
  setScopeFrameDeclarationBinding,
  type BindingCell,
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
import type { JsFunction } from './js-function.js';
import type { Func } from './function.js';
import {
  type DirectDeclarationOccurrence,
  findAnyDeclarationOccurrence,
  findPropertyDeclarationOccurrence,
  findVariableDeclarationOccurrence
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
  excludedDeclarations?: readonly Node[];
  requiredDeclarationAssignments?: string | readonly string[];
  role?: AnyRole;
  preserveRulesLike?: boolean;
  /** Internal call-site hint: terminal mixin-ruleset lookup cannot use rulesets when args are present. */
  mixinRulesetCallHasArgs?: boolean;
};

// `sourceNode` stays on the public shallow-owned surface for compatibility and
// now carries the canonical source directly.
type PreservedRulesLikeValue = Node & { sourceNode?: Node };

const REF_EVAL_PRESERVE_RULES_LIKE = 1;
const REF_EVAL_REUSE_SOURCE_FREE = 1 << 1;
const DIRECT_DECLARATION_LOOKUP_CACHE_KEY_SEPARATOR = '\u001f';

function invalidateDirectDeclarationLookupKey(scope: Rules, key: string): void {
  const versions = scope.declarationLookupVersionsByName ??= new Map<string, number>();
  versions.set(key, scope.getDeclarationLookupVersion(key) + 1);
  scope.directDeclarationsByName?.delete(key);
  const cache = scope.directDeclarationLookupCache;
  if (!cache?.size) {
    return;
  }
  const cacheKeyPrefix = `${key}${DIRECT_DECLARATION_LOOKUP_CACHE_KEY_SEPARATOR}`;
  for (const cacheKey of cache.keys()) {
    if (cacheKey.startsWith(cacheKeyPrefix)) {
      cache.delete(cacheKey);
    }
  }
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
  let firstInvalidatedName: string | undefined;
  let invalidatedNames: Set<string> | undefined;

  for (const decl of frame.pendingDeclarationNames) {
    if (decl.parent !== scope) {
      remaining.push(decl);
      continue;
    }

    const declName = decl.name;
    const isStaticName = !(declName instanceof Node) || declName.hasFlag(F_STATIC);
    if (!isStaticName) {
      remaining.push(decl);
      continue;
    }

    const resolvedName = `${declName.valueOf()}`;
    if (firstInvalidatedName === undefined) {
      firstInvalidatedName = resolvedName;
    } else if (firstInvalidatedName !== resolvedName) {
      (invalidatedNames ??= new Set([firstInvalidatedName])).add(resolvedName);
    }
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
      const entry = createVarDeclarationBindingEntry(decl);
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
    if (invalidatedNames) {
      for (const resolvedName of invalidatedNames) {
        invalidateDirectDeclarationLookupKey(scope, resolvedName);
      }
    } else if (firstInvalidatedName !== undefined) {
      invalidateDirectDeclarationLookupKey(scope, firstInvalidatedName);
    }
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
    for (const node of selector.components) {
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
const SCOPE_FRAME_VARIABLE_MISS = Symbol('scope-frame-variable-miss');
const CACHED_RULES_LOOKUP_MISS = Symbol('cached-rules-lookup-miss');
type ScopeFrameVariableBindingHandle = {
  kind: 'scope-frame-variable-binding-handle';
  cell: BindingCell;
  cellLookupIdentity: number;
  ownerFrame: ScopeFrame;
  ownerFrameCurrentBindingsVersion: number;
  currentBindingKey?: string;
  currentBindingFrame?: ScopeFrame;
  currentBindingVersion?: number;
  currentBindingRestFrames?: ScopeFrame[];
  currentBindingRestVersions?: number[];
  sourceNode?: Node;
  rulesContext?: Rules;
};
type ScopeFrameVariableBindingResult = ScopeFrameVariableBindingHandle | typeof SCOPE_FRAME_VARIABLE_MISS | undefined;
type DirectTargetReferenceLookupReturnValue = Node | undefined;
type IndexReferenceLookupReturnValue =
  | DirectTargetReferenceLookupReturnValue
  | ScopeFrameVariableBindingHandle
  | DirectDeclarationOccurrence;
type DeclarationReferenceLookupReturnValue = DirectDeclarationOccurrence | undefined;
type VariableReferenceLookupReturnValue = ScopeFrameVariableBindingHandle | DirectDeclarationOccurrence | undefined;
type FunctionReferenceLookupReturnValue = JsFunction | Func | undefined;
type CallableReferenceLookupReturnValue = MixinEntry[] | undefined;
type VariableRulesLookupHandleValue =
  | ScopeFrameVariableBindingHandle
  | DirectDeclarationOccurrence
  | typeof CACHED_RULES_LOOKUP_MISS;
type DeclarationRulesLookupHandleValue = DirectDeclarationOccurrence | typeof CACHED_RULES_LOOKUP_MISS;
type FunctionRulesLookupHandleValue = Exclude<FunctionReferenceLookupReturnValue, undefined> | typeof CACHED_RULES_LOOKUP_MISS;
type CallableRulesLookupHandleValue = MixinEntry[] | typeof CACHED_RULES_LOOKUP_MISS;
type RulesLookupHandleReadResult =
  | VariableRulesLookupHandleValue
  | DeclarationRulesLookupHandleValue
  | FunctionRulesLookupHandleValue
  | CallableRulesLookupHandleValue
  | undefined;
type ReferenceLookupReturnValue =
  | DirectTargetReferenceLookupReturnValue
  | ScopeFrameVariableBindingHandle
  | DirectDeclarationOccurrence
  | FunctionReferenceLookupReturnValue
  | CallableReferenceLookupReturnValue;

type ReferenceRulesLookupHandleBase = {
  targetRules: Rules;
  targetLookupVersion: number;
  valueKey: string | string[];
  currentBindingKey?: string;
  currentBindingFrame?: ScopeFrame;
  currentBindingVersion?: number;
  currentBindingRestFrames?: ScopeFrame[];
  currentBindingRestVersions?: number[];
  inCall: boolean;
  start: number | undefined;
  local: boolean;
  ignoreParentScopeStart: boolean;
  terminalMixinOnly: boolean;
};

type ReferenceRulesLookupDeclarationConstraints = {
  requiredDeclarationAssignmentsKey: string | undefined;
  excludedDeclaration0: Node | undefined;
  excludedDeclaration1: Node | undefined;
};

type ReferenceRulesLookupHandle =
  | (ReferenceRulesLookupHandleBase & ReferenceRulesLookupDeclarationConstraints & {
    lookupType: 'declaration' | 'property';
    returnVal: DeclarationRulesLookupHandleValue;
  })
  | (ReferenceRulesLookupHandleBase & {
    lookupType: 'function';
    returnVal: FunctionRulesLookupHandleValue;
  })
  | (ReferenceRulesLookupHandleBase & {
    lookupType: 'mixin' | 'mixin-ruleset';
    returnVal: CallableRulesLookupHandleValue;
  })
  | (ReferenceRulesLookupHandleBase & ReferenceRulesLookupDeclarationConstraints & {
    lookupType: 'variable';
    returnVal: VariableRulesLookupHandleValue;
  });
type ReferenceRulesLookupDeclarationHandle = Extract<
  ReferenceRulesLookupHandle,
  { lookupType: 'declaration' | 'property' | 'variable' }
>;

function getRulesLookupHandleVersion(
  targetRules: Rules,
  lookupType: RulesLookupHandleLookupType,
  valueKey: string | string[]
): number {
  if (lookupType === 'mixin' || lookupType === 'mixin-ruleset') {
    return targetRules.callableLookupVersion;
  }
  if (lookupType === 'function') {
    return typeof valueKey === 'string'
      ? targetRules.functionLookupVersionsByName?.get(valueKey) ?? 0
      : targetRules.functionLookupVersion;
  }
  if (
    typeof valueKey === 'string'
    && (
      lookupType === 'declaration'
      || lookupType === 'property'
      || lookupType === 'variable'
    )
  ) {
    return targetRules.getDeclarationLookupVersion(valueKey);
  }
  return targetRules.lookupVersion;
}

function isRulesLookupHandleVersionCurrent(
  handle: ReferenceRulesLookupHandle,
  targetRules: Rules,
  lookupType: RulesLookupHandleLookupType,
  valueKey: string | string[]
): boolean {
  const currentVersion = getRulesLookupHandleVersion(targetRules, lookupType, valueKey);
  return handle.targetLookupVersion === currentVersion;
}

function isDirectDeclarationOccurrence(value: unknown): value is DirectDeclarationOccurrence {
  return (
    value !== null
    && typeof value === 'object'
    && 'kind' in value
    && value.kind === 'direct-declaration-occurrence'
  );
}

function isRulesLookupResult(value: unknown): value is Exclude<ReferenceLookupReturnValue, undefined> {
  return isNode(value) || Array.isArray(value) || isDirectDeclarationOccurrence(value);
}

function isScopeFrameVariableBindingHandle(value: unknown): value is ScopeFrameVariableBindingHandle {
  return (
    value !== null
    && typeof value === 'object'
    && 'kind' in value
    && value.kind === 'scope-frame-variable-binding-handle'
  );
}

function createScopeFrameVariableBindingHandle(
  cell: BindingCell,
  sourceNode: Node | undefined,
  ownerFrame: ScopeFrame,
  targetFrame: ScopeFrame,
  key: string
): ScopeFrameVariableBindingHandle {
  const currentBindingFact = getAncestorFrameCurrentBindingFacts(targetFrame, key, ownerFrame);
  return {
    kind: 'scope-frame-variable-binding-handle',
    cell,
    cellLookupIdentity: ensureBindingCellLookupIdentity(cell),
    ownerFrame,
    ownerFrameCurrentBindingsVersion: ownerFrame.currentBindingsVersion,
    currentBindingKey: currentBindingFact?.currentBindingKey,
    currentBindingFrame: currentBindingFact?.currentBindingFrame,
    currentBindingVersion: currentBindingFact?.currentBindingVersion,
    currentBindingRestFrames: currentBindingFact?.currentBindingRestFrames,
    currentBindingRestVersions: currentBindingFact?.currentBindingRestVersions,
    sourceNode,
    rulesContext: isNode(cell.rulesContext, N.Rules) ? cell.rulesContext : undefined
  };
}

function getBindingHandleValue(handle: ScopeFrameVariableBindingHandle): Node {
  return getBindingCellValue(handle.cell);
}

function getBindingHandleRulesContext(handle: ScopeFrameVariableBindingHandle): Rules | undefined {
  return isNode(handle.cell.rulesContext, N.Rules) ? handle.cell.rulesContext : handle.rulesContext;
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

type RulesReferenceLookupContext = {
  referenceNode: Reference;
  lookupType: LookupType;
  strategy: ReferenceLookupStrategy;
  target: ReferenceValue['target'];
  resolution: ReferenceOptions['resolution'];
  isInterpolatedVariable: boolean;
  filter: (n: Node) => boolean;
  semanticFilter: boolean;
  context: Context;
  hasTarget: boolean;
  valueKey: NormalizedLookupKey;
  env: RulesLookupAdapterEnv;
  preparedRules?: Rules;
  preparedShape?: RulesLookupHandleShape;
};

type PreparedReferenceLookup = {
  env: RulesLookupAdapterEnv;
};

type ReferenceDeclarationFindOptions = DeclarationFindOptions & { context: Context };
type ScopeFrameVariableBindingMode = 'full' | 'live-current';
type ReferenceLookupStrategyBase = {
  readonly lookupType: LookupType;
  readonly performRulesLookup: (
    scope: Rules,
    lookupContext: RulesReferenceLookupContext,
    shape: RulesLookupHandleShape
  ) => ReferenceLookupReturnValue;
};
type ReferenceHandleLookupStrategyBase = ReferenceLookupStrategyBase & {
  readonly handleLookupType: RulesLookupHandleLookupType;
  readonly getHandleValueKey: (valueKey: NormalizedLookupKey) => string | string[] | undefined;
  readonly tryReadSourceStaticHandle: (
    referenceNode: Reference,
    targetRules: Rules | undefined,
    valueKey: NormalizedLookupKey,
    env: RulesLookupAdapterEnv
  ) => RulesLookupHandleReadResult;
};
type ReferenceDeclarationLookupStrategy = ReferenceHandleLookupStrategyBase & {
  readonly lookupType: 'declaration' | 'property' | 'variable';
  readonly handleLookupType: 'declaration' | 'property' | 'variable';
  readonly readHandle: (
    referenceNode: Reference,
    targetRules: Rules | undefined,
    lookupType: RulesLookupHandleLookupType | undefined,
    valueKey: string | string[] | undefined,
    inCall: boolean,
    shape: RulesLookupHandleShape | undefined,
    declarationConstraints: ReferenceRulesLookupDeclarationConstraints | undefined
  ) => RulesLookupHandleReadResult;
  readonly writeHandle: (
    referenceNode: Reference,
    targetRules: Rules | undefined,
    lookupType: RulesLookupHandleLookupType | undefined,
    valueKey: string | string[] | undefined,
    inCall: boolean,
    shape: RulesLookupHandleShape | undefined,
    returnVal: ReferenceLookupReturnValue,
    declarationConstraints: ReferenceRulesLookupDeclarationConstraints | undefined
  ) => void;
  readonly getHandleDeclarationConstraints: (
    referenceNode: Reference
  ) => ReferenceRulesLookupDeclarationConstraints | undefined;
};
type ReferencePlainHandleLookupStrategy = ReferenceHandleLookupStrategyBase & {
  readonly lookupType: 'function' | 'mixin' | 'mixin-ruleset';
  readonly handleLookupType: 'function' | 'mixin' | 'mixin-ruleset';
  readonly readHandle: (
    referenceNode: Reference,
    targetRules: Rules | undefined,
    lookupType: RulesLookupHandleLookupType | undefined,
    valueKey: string | string[] | undefined,
    inCall: boolean,
    shape: RulesLookupHandleShape | undefined
  ) => RulesLookupHandleReadResult;
  readonly writeHandle: (
    referenceNode: Reference,
    targetRules: Rules | undefined,
    lookupType: RulesLookupHandleLookupType | undefined,
    valueKey: string | string[] | undefined,
    inCall: boolean,
    shape: RulesLookupHandleShape | undefined,
    returnVal: ReferenceLookupReturnValue
  ) => void;
  readonly getHandleDeclarationConstraints?: never;
};
type ReferenceNoHandleLookupStrategy = ReferenceLookupStrategyBase & {
  readonly lookupType: 'index';
  readonly handleLookupType?: never;
  readonly readHandle?: never;
  readonly writeHandle?: never;
  readonly getHandleValueKey?: never;
  readonly tryReadSourceStaticHandle?: never;
  readonly getHandleDeclarationConstraints?: never;
};
type ReferenceHandleLookupStrategy = ReferenceDeclarationLookupStrategy | ReferencePlainHandleLookupStrategy;
type ReferenceLookupStrategy = ReferenceHandleLookupStrategy | ReferenceNoHandleLookupStrategy;

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

type BuildReferenceLookupShapeArgs = {
  referenceNode: Reference;
  lookupType: LookupType;
  target: ReferenceValue['target'];
  targetRules: Rules;
  resolution: ReferenceOptions['resolution'];
  isInterpolatedVariable: boolean;
  context: Context;
};

function buildRulesLookupHandleShape(args: BuildReferenceLookupShapeArgs): RulesLookupHandleShape {
  const {
    referenceNode,
    lookupType,
    target,
    targetRules,
    resolution,
    isInterpolatedVariable,
    context
  } = args;
  const local = shouldUseLocalReferenceLookup({ target, targetRules });
  let start: number | undefined;
  let ignoreParentScopeStart = false;

  if (!isInterpolatedVariable) {
    if (resolution === 'live') {
      start = context.rulesContext?.index ?? getLookupStartIndex(referenceNode);
    } else if (!target && lookupTypeNeedsContextualStart(lookupType)) {
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
    start,
    local,
    ignoreParentScopeStart,
    terminalMixinOnly: referenceNode.options.mixinRulesetCallHasArgs === true
  };
}

function prepareRulesLookupShape(
  lookupContext: RulesReferenceLookupContext,
  targetRules: Rules
): RulesLookupHandleShape {
  const shape = buildRulesLookupHandleShape({
    referenceNode: lookupContext.referenceNode,
    lookupType: lookupContext.lookupType,
    target: lookupContext.target,
    targetRules,
    resolution: lookupContext.resolution,
    isInterpolatedVariable: lookupContext.isInterpolatedVariable,
    context: lookupContext.context
  });
  lookupContext.preparedRules = targetRules;
  lookupContext.preparedShape = shape;
  return shape;
}

function lookupTypeNeedsContextualStart(lookupType: LookupType): boolean {
  return (
    lookupType === 'property'
    || lookupType === 'variable'
    || lookupType === 'declaration'
  );
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
  env: RulesLookupAdapterEnv,
  mode: ScopeFrameVariableBindingMode = 'full'
): ScopeFrameVariableBindingResult {
  if (mode === 'full' && (
    env.hasTarget
    || env.isInterpolatedVariable
    || (opts.start !== undefined && env.readMode !== 'snapshot')
  )) {
    return undefined;
  }
  const frame = targetRules.getScopeFrame(undefined, false);
  if (mode === 'full') {
    promoteResolvedPendingVarDecls(targetRules, frame);
  }
  const hit = lookupScopeFrameVariable(frame, key, {
    start: mode === 'full' ? opts.start : undefined,
    filter: env.filter,
    blockedSource: node => env.context.searchScope.has(node),
    includeLive: mode === 'live-current' || env.readMode !== 'snapshot',
    includeDeclarations: mode === 'live-current' ? false : undefined,
    bailOnPendingDeclarations: mode === 'full'
  });
  if (hit.kind === 'uncovered') {
    return undefined;
  }
  if (hit.kind === 'miss') {
    return mode === 'full' ? SCOPE_FRAME_VARIABLE_MISS : undefined;
  }
  if (mode === 'live-current' && hit.kind !== 'live') {
    return undefined;
  }
  const { cell, sourceNode, frame: ownerFrame } = hit;
  return createScopeFrameVariableBindingHandle(cell, sourceNode, ownerFrame, frame, key);
}

function lookupIndexReference(
  targetRules: Rules,
  valueKey: NormalizedLookupKey,
  opts: ReferenceDeclarationFindOptions,
  env: RulesLookupAdapterEnv
): IndexReferenceLookupReturnValue {
  if (typeof valueKey === 'number') {
    return targetRules.at(valueKey);
  }
  const keyStr = getLookupKeyString(valueKey);
  if (!isNode(env.keyNode, N.Quoted)) {
    const live = lookupScopeFrameVariableBinding(targetRules, keyStr, opts, env, 'live-current');
    if (live && live !== SCOPE_FRAME_VARIABLE_MISS) {
      return live;
    }
  }
  return isNode(env.keyNode, N.Quoted)
    ? findPropertyDeclarationOccurrence(targetRules, keyStr, opts)
    : findVariableDeclarationOccurrence(targetRules, keyStr, opts);
}

function lookupPropertyReference(
  targetRules: Rules,
  valueKey: NormalizedLookupKey,
  opts: ReferenceDeclarationFindOptions,
  _env: RulesLookupAdapterEnv
): DeclarationReferenceLookupReturnValue {
  return findPropertyDeclarationOccurrence(targetRules, getLookupKeyString(valueKey), opts);
}

function lookupDeclarationReference(
  targetRules: Rules,
  valueKey: NormalizedLookupKey,
  opts: ReferenceDeclarationFindOptions,
  _env: RulesLookupAdapterEnv
): DeclarationReferenceLookupReturnValue {
  return findAnyDeclarationOccurrence(targetRules, getLookupKeyString(valueKey), opts);
}

function buildReferenceDeclarationFindOptions(
  lookupContext: RulesReferenceLookupContext,
  shape: RulesLookupHandleShape
): ReferenceDeclarationFindOptions {
  return {
    filter: lookupContext.filter,
    excludedDeclarations: lookupContext.referenceNode.options.excludedDeclarations,
    requiredDeclarationAssignments: lookupContext.referenceNode.options.requiredDeclarationAssignments,
    semanticFilter: lookupContext.semanticFilter,
    context: lookupContext.context,
    hasTarget: lookupContext.hasTarget,
    local: shape.local || undefined,
    start: shape.start,
    ignoreParentScopeStart: shape.ignoreParentScopeStart || undefined
  };
}

function performIndexRulesLookup(
  scope: Rules,
  lookupContext: RulesReferenceLookupContext,
  shape: RulesLookupHandleShape
): IndexReferenceLookupReturnValue {
  return lookupIndexReference(
    scope,
    lookupContext.valueKey,
    buildReferenceDeclarationFindOptions(lookupContext, shape),
    lookupContext.env
  );
}

function performPropertyRulesLookup(
  scope: Rules,
  lookupContext: RulesReferenceLookupContext,
  shape: RulesLookupHandleShape
): DeclarationReferenceLookupReturnValue {
  return lookupPropertyReference(
    scope,
    lookupContext.valueKey,
    buildReferenceDeclarationFindOptions(lookupContext, shape),
    lookupContext.env
  );
}

function performVariableRulesLookup(
  scope: Rules,
  lookupContext: RulesReferenceLookupContext,
  shape: RulesLookupHandleShape
): VariableReferenceLookupReturnValue {
  const { env, valueKey } = lookupContext;
  const keyStr = getLookupKeyString(valueKey);
  const frameMode: ScopeFrameVariableBindingMode | undefined = typeof valueKey === 'string'
    && !env.hasTarget
    && !env.isInterpolatedVariable
    && !(shape.start !== undefined && env.readMode !== 'snapshot')
    ? 'full'
    : env.readMode !== 'snapshot'
      ? 'live-current'
      : undefined;
  if (frameMode) {
    const frameHit = lookupScopeFrameVariableBinding(scope, keyStr, {
      start: shape.start,
      filter: env.filter
    }, env, frameMode);
    if (frameHit) {
      return frameHit === SCOPE_FRAME_VARIABLE_MISS ? undefined : frameHit;
    }
  }
  return findVariableDeclarationOccurrence(scope, keyStr, {
    start: shape.start,
    context: env.context,
    hasTarget: env.hasTarget,
    local: shape.local || undefined,
    filter: env.filter,
    includeLiveBindings: env.readMode !== 'snapshot',
    ignoreCurrentScopeStart: true,
    ignoreParentScopeStart: shape.ignoreParentScopeStart || undefined
  });
}

function performDeclarationRulesLookup(
  scope: Rules,
  lookupContext: RulesReferenceLookupContext,
  shape: RulesLookupHandleShape
): DeclarationReferenceLookupReturnValue {
  return lookupDeclarationReference(
    scope,
    lookupContext.valueKey,
    buildReferenceDeclarationFindOptions(lookupContext, shape),
    lookupContext.env
  );
}

function performFunctionRulesLookup(
  scope: Rules,
  lookupContext: RulesReferenceLookupContext,
  shape: RulesLookupHandleShape
): FunctionReferenceLookupReturnValue {
  return scope.findFunction(getLookupKeyString(lookupContext.valueKey), undefined, {
    context: lookupContext.context,
    hasTarget: lookupContext.hasTarget,
    local: shape.local || undefined,
    terminalMixinOnly: shape.terminalMixinOnly || undefined
  });
}

function shouldPrepareCallableReferenceFrame(
  scope: Rules,
  lookupContext: RulesReferenceLookupContext,
  shape: RulesLookupHandleShape,
  key: string | string[]
): key is string {
  if (typeof key !== 'string' || lookupContext.hasTarget || shape.local) {
    return false;
  }
  if (!lookupContext.env.isInterpolatedVariable) {
    return true;
  }
  const root = lookupContext.context.root;
  const contextRules = lookupContext.context.rulesContext;
  return (
    scope._hasReferenceImports
    || scope.hasReferenceImportChildSurface
    || (isNode(root, N.Rules) && (root._hasReferenceImports || root.hasReferenceImportChildSurface))
    || (isNode(contextRules, N.Rules) && (contextRules._hasReferenceImports || contextRules.hasReferenceImportChildSurface))
  );
}

function performMixinRulesLookup(
  scope: Rules,
  lookupContext: RulesReferenceLookupContext,
  shape: RulesLookupHandleShape
): CallableReferenceLookupReturnValue {
  const key = Array.isArray(lookupContext.valueKey) ? lookupContext.valueKey : getLookupKeyString(lookupContext.valueKey);
  if (shouldPrepareCallableReferenceFrame(scope, lookupContext, shape, key)) {
    scope.getScopeFrame();
  }
  return scope.findMixin(
    key,
    'Mixin',
    {
      context: lookupContext.context,
      hasTarget: lookupContext.hasTarget,
      local: shape.local || undefined,
      terminalMixinOnly: shape.terminalMixinOnly || undefined
    }
  );
}

function performMixinRulesetRulesLookup(
  scope: Rules,
  lookupContext: RulesReferenceLookupContext,
  shape: RulesLookupHandleShape
): CallableReferenceLookupReturnValue {
  const key = Array.isArray(lookupContext.valueKey) ? lookupContext.valueKey : getLookupKeyString(lookupContext.valueKey);
  if (shouldPrepareCallableReferenceFrame(scope, lookupContext, shape, key)) {
    scope.getScopeFrame();
  }
  return scope.findMixin(
    key,
    undefined,
    {
      context: lookupContext.context,
      hasTarget: lookupContext.hasTarget,
      local: shape.local || undefined,
      terminalMixinOnly: shape.terminalMixinOnly || undefined
    }
  );
}

function lookupRulesReferenceTarget(args: {
  resolvedTarget: Rules;
  context: Context;
  rulesParent: Rules | undefined;
  sourceRulesParent: Rules | undefined;
  lookupContext: RulesReferenceLookupContext;
}): MaybePromise<ReferenceLookupReturnValue> {
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
}): MaybePromise<ReferenceLookupReturnValue> {
  const rulesParent = args.rulesParent;
  if (isNode(rulesParent, N.Rules)) {
    prepareRulesLookupShape(args.lookupContext, rulesParent);
    const result = performRulesReferenceLookup(rulesParent, args.lookupContext);
    if (isThenable(result)) {
      return Promise.resolve(result).then((resolved) => {
        if (isRulesLookupResult(resolved)) {
          return resolved;
        }
        const sourceRulesParent = args.sourceRulesParent;
        if (!isNode(sourceRulesParent, N.Rules) || sourceRulesParent === rulesParent) {
          return undefined;
        }
        prepareRulesLookupShape(args.lookupContext, sourceRulesParent);
        return performRulesReferenceLookup(sourceRulesParent, args.lookupContext);
      });
    }
    if (result !== undefined) {
      return result;
    }
  }

  const sourceRulesParent = args.sourceRulesParent;
  if (!isNode(sourceRulesParent, N.Rules) || sourceRulesParent === rulesParent) {
    return undefined;
  }
  prepareRulesLookupShape(args.lookupContext, sourceRulesParent);
  return performRulesReferenceLookup(sourceRulesParent, args.lookupContext);
}

function lookupReferenceTarget(args: {
  resolvedTarget: Node | undefined;
  lookupType: LookupType;
  valueKey: NormalizedLookupKey;
  context: Context;
  rulesParent: Rules | undefined;
  sourceRulesParent: Rules | undefined;
  lookupContext: RulesReferenceLookupContext;
}): MaybePromise<ReferenceLookupReturnValue> {
  const {
    resolvedTarget,
    lookupType,
    valueKey,
    context,
    rulesParent,
    sourceRulesParent,
    lookupContext
  } = args;

  if (!isNode(resolvedTarget, N.Rules)) {
    return lookupDirectTarget(resolvedTarget, lookupType, valueKey);
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
): ReferenceLookupReturnValue {
  const {
    referenceNode,
    target,
    resolution,
    isInterpolatedVariable,
    context,
    lookupType
  } = lookupContext;
  const preparedShape = lookupContext.preparedRules === scope
    ? lookupContext.preparedShape
    : undefined;
  const shape = preparedShape ?? buildRulesLookupHandleShape({
    referenceNode,
    lookupType,
    target,
    targetRules: scope,
    resolution,
    isInterpolatedVariable,
    context
  });
  return lookupContext.strategy.performRulesLookup(scope, lookupContext, shape);
}

type RulesLookupHandleLookupType = 'declaration' | 'function' | 'mixin' | 'mixin-ruleset' | 'property' | 'variable';

function getRequiredDeclarationAssignmentsHandleKey(
  required: ReferenceOptions['requiredDeclarationAssignments']
): string | undefined {
  if (required === undefined) {
    return undefined;
  }
  if (Array.isArray(required)) {
    switch (required.length) {
      case 0:
        return '0:';
      case 1:
        return `1:${required[0]}`;
      case 2:
        return `2:${required[0]}\u001e${required[1]}`;
      case 3:
        return `3:${required[0]}\u001e${required[1]}\u001e${required[2]}`;
      case 4:
        return `4:${required[0]}\u001e${required[1]}\u001e${required[2]}\u001e${required[3]}`;
      default:
        return undefined;
    }
  }
  return `1:${required}`;
}

function getRulesLookupHandleDeclarationConstraints(
  referenceNode: Reference
): ReferenceRulesLookupDeclarationConstraints {
  const excludedDeclarations = referenceNode.options.excludedDeclarations;
  return {
    requiredDeclarationAssignmentsKey: getRequiredDeclarationAssignmentsHandleKey(
      referenceNode.options.requiredDeclarationAssignments
    ),
    excludedDeclaration0: excludedDeclarations?.[0],
    excludedDeclaration1: excludedDeclarations?.[1]
  };
}

function hasHandleableDeclarationConstraints(referenceNode: Reference): boolean {
  const excludedDeclarations = referenceNode.options.excludedDeclarations;
  const excludedDeclarationCount = excludedDeclarations?.length ?? 0;
  const requiredDeclarationAssignments = referenceNode.options.requiredDeclarationAssignments;
  return (
    excludedDeclarationCount <= 2
    && (
      !Array.isArray(requiredDeclarationAssignments)
      || requiredDeclarationAssignments.length <= 4
    )
  );
}

function getStringRulesLookupHandleValueKey(valueKey: NormalizedLookupKey): string | undefined {
  return typeof valueKey === 'string' ? valueKey : undefined;
}

function getCallableRulesLookupHandleValueKey(valueKey: NormalizedLookupKey): string | string[] | undefined {
  return typeof valueKey === 'string' || Array.isArray(valueKey) ? valueKey : undefined;
}

function getStaticReferenceValueKey(valueKey: ReferenceValue['key']): NormalizedLookupKey | undefined {
  if (typeof valueKey === 'string' || typeof valueKey === 'number') {
    return valueKey;
  }
  if (Array.isArray(valueKey) && isStringArray(valueKey)) {
    return valueKey;
  }
  return undefined;
}

function getHandleableDeclarationConstraints(
  referenceNode: Reference
): ReferenceRulesLookupDeclarationConstraints | undefined {
  return hasHandleableDeclarationConstraints(referenceNode)
    ? getRulesLookupHandleDeclarationConstraints(referenceNode)
    : undefined;
}

function rulesLookupHandleCommonEligible(
  target: ReferenceValue['target'],
  originalFilter: ReferenceOptions['filter'] | undefined,
  env: RulesLookupAdapterEnv,
  context: Context
): boolean {
  return (
    target === undefined
    && originalFilter === undefined
    && !env.semanticFilter
    && !env.hasTarget
    && !env.isInterpolatedVariable
    && context.leakyRules !== true
    && context.searchScope.size === 0
  );
}

function getStrategyRulesLookupHandleValueKey(args: {
  strategy: ReferenceHandleLookupStrategy;
  valueKey: NormalizedLookupKey;
  target: ReferenceValue['target'];
  originalFilter: ReferenceOptions['filter'] | undefined;
  env: RulesLookupAdapterEnv;
  context: Context;
}): string | string[] | undefined {
  if (!rulesLookupHandleCommonEligible(args.target, args.originalFilter, args.env, args.context)) {
    return undefined;
  }
  return args.strategy.getHandleValueKey(args.valueKey);
}

type RulesLookupHandleShape = {
  start: number | undefined;
  local: boolean;
  ignoreParentScopeStart: boolean;
  terminalMixinOnly: boolean;
};

function getAncestorFrameCurrentBindingFacts(
  targetFrame: ScopeFrame,
  key: string,
  ownerFrame: ScopeFrame
): {
  currentBindingKey: string;
  currentBindingFrame?: ScopeFrame;
  currentBindingVersion?: number;
  currentBindingRestFrames?: ScopeFrame[];
  currentBindingRestVersions?: number[];
} | undefined {
  if (ownerFrame === targetFrame) {
    return {
      currentBindingKey: key
    };
  }
  let currentBindingFrame: ScopeFrame | undefined;
  let currentBindingVersion: number | undefined;
  let currentBindingRestFrames: ScopeFrame[] | undefined;
  let currentBindingRestVersions: number[] | undefined;
  let frame: ScopeFrame | undefined = targetFrame;
  while (frame) {
    if (frame === ownerFrame) {
      return {
        currentBindingKey: key,
        currentBindingFrame,
        currentBindingVersion,
        currentBindingRestFrames,
        currentBindingRestVersions
      };
    }
    if (frame.currentBindingsByName.has(key)) {
      return undefined;
    }
    if (currentBindingFrame === undefined) {
      currentBindingFrame = frame;
      currentBindingVersion = frame.currentBindingsVersion;
    } else {
      if (!currentBindingRestFrames || !currentBindingRestVersions) {
        currentBindingRestFrames = [];
        currentBindingRestVersions = [];
      }
      currentBindingRestFrames.push(frame);
      currentBindingRestVersions.push(frame.currentBindingsVersion);
    }
    frame = frame.parent;
  }
  return undefined;
}

function getAncestorVariableCurrentBindingFacts(
  targetRules: Rules,
  key: string,
  occurrence: DirectDeclarationOccurrence
): ReturnType<typeof getAncestorFrameCurrentBindingFacts> {
  if (occurrence.ownerRules === targetRules) {
    return {
      currentBindingKey: key
    };
  }
  if (!occurrence.ownerRules) {
    return undefined;
  }
  const targetFrame = targetRules.getScopeFrame(undefined, false);
  let ownerFrame: ScopeFrame | undefined = targetFrame;
  while (ownerFrame) {
    if (ownerFrame.rulesNode === occurrence.ownerRules) {
      return getAncestorFrameCurrentBindingFacts(targetFrame, key, ownerFrame);
    }
    ownerFrame = ownerFrame.parent;
  }
  return undefined;
}

function areCurrentBindingFactsCurrent(args: {
  currentBindingKey: string | undefined;
  currentBindingFrame: ScopeFrame | undefined;
  currentBindingVersion: number | undefined;
  currentBindingRestFrames: ScopeFrame[] | undefined;
  currentBindingRestVersions: number[] | undefined;
}): boolean {
  const {
    currentBindingKey,
    currentBindingFrame,
    currentBindingVersion,
    currentBindingRestFrames,
    currentBindingRestVersions
  } = args;
  if (currentBindingKey === undefined) {
    return true;
  }
  if (
    currentBindingFrame
    && (
      currentBindingFrame.currentBindingsVersion !== currentBindingVersion
      || currentBindingFrame.currentBindingsByName.has(currentBindingKey)
    )
  ) {
    return false;
  }
  if (!currentBindingRestFrames) {
    return true;
  }
  if (
    !currentBindingRestVersions
    || currentBindingRestVersions.length !== currentBindingRestFrames.length
  ) {
    return false;
  }
  for (let i = 0; i < currentBindingRestFrames.length; i++) {
    if (
      currentBindingRestFrames[i]!.currentBindingsVersion !== currentBindingRestVersions[i]
      || currentBindingRestFrames[i]!.currentBindingsByName.has(currentBindingKey)
    ) {
      return false;
    }
  }
  return true;
}

function readCurrentRulesLookupHandleValue(
  handle: ReferenceRulesLookupHandle
): RulesLookupHandleReadResult {
  if (isScopeFrameVariableBindingHandle(handle.returnVal)) {
    if (
      handle.returnVal.ownerFrame.currentBindingsVersion !== handle.returnVal.ownerFrameCurrentBindingsVersion
      || handle.returnVal.cell.lookupIdentity !== handle.returnVal.cellLookupIdentity
      || !areCurrentBindingFactsCurrent(handle.returnVal)
    ) {
      return undefined;
    }
    return handle.returnVal;
  }
  if (!areCurrentBindingFactsCurrent(handle)) {
    return undefined;
  }
  if (isDirectDeclarationOccurrence(handle.returnVal)) {
    const node = handle.returnVal.node;
    if (
      node.parent !== handle.returnVal.ownerRules
      || handle.returnVal.ownerRules?.getDeclarationLookupVersion(String(node.name.valueOf())) !== handle.returnVal.ownerLookupVersion
      || node.index !== handle.returnVal.index
    ) {
      return undefined;
    }
    return handle.returnVal;
  }
  return handle.returnVal;
}

function readRulesLookupHandleBase(
  referenceNode: Reference,
  targetRules: Rules | undefined,
  lookupType: RulesLookupHandleLookupType | undefined,
  valueKey: string | string[] | undefined,
  inCall: boolean,
  shape: RulesLookupHandleShape | undefined
): ReferenceRulesLookupHandle | undefined {
  if (!targetRules || !lookupType || !valueKey || !shape) {
    return undefined;
  }
  const handle = referenceNode._rulesLookupHandle;
  if (
    !handle
    || handle.targetRules !== targetRules
    || !isRulesLookupHandleVersionCurrent(handle, targetRules, lookupType, valueKey)
    || handle.lookupType !== lookupType
    || handle.inCall !== inCall
    || handle.start !== shape.start
    || handle.local !== shape.local
    || handle.ignoreParentScopeStart !== shape.ignoreParentScopeStart
    || handle.terminalMixinOnly !== shape.terminalMixinOnly
    || handle.valueKey !== valueKey
  ) {
    return undefined;
  }
  return handle;
}

function isDeclarationRulesLookupHandle(
  handle: ReferenceRulesLookupHandle
): handle is ReferenceRulesLookupDeclarationHandle {
  switch (handle.lookupType) {
    case 'declaration':
    case 'property':
    case 'variable':
      return true;
    case 'function':
    case 'mixin':
    case 'mixin-ruleset':
      return false;
  }
}

function readDeclarationRulesLookupHandleConstraints(
  handle: ReferenceRulesLookupHandle,
  declarationConstraints: ReferenceRulesLookupDeclarationConstraints
): ReferenceRulesLookupDeclarationHandle | undefined {
  if (
    !isDeclarationRulesLookupHandle(handle)
    || handle.requiredDeclarationAssignmentsKey !== declarationConstraints.requiredDeclarationAssignmentsKey
    || handle.excludedDeclaration0 !== declarationConstraints.excludedDeclaration0
    || handle.excludedDeclaration1 !== declarationConstraints.excludedDeclaration1
  ) {
    return undefined;
  }
  return handle;
}

function readDeclarationRulesLookupHandle(
  referenceNode: Reference,
  targetRules: Rules | undefined,
  lookupType: RulesLookupHandleLookupType | undefined,
  valueKey: string | string[] | undefined,
  inCall: boolean,
  shape: RulesLookupHandleShape | undefined,
  declarationConstraints: ReferenceRulesLookupDeclarationConstraints | undefined
): RulesLookupHandleReadResult {
  const handle = readRulesLookupHandleBase(referenceNode, targetRules, lookupType, valueKey, inCall, shape);
  const declarationHandle = handle && declarationConstraints
    ? readDeclarationRulesLookupHandleConstraints(handle, declarationConstraints)
    : undefined;
  if (!declarationHandle) {
    return undefined;
  }
  return readCurrentRulesLookupHandleValue(declarationHandle);
}

function readVariableRulesLookupHandle(
  referenceNode: Reference,
  targetRules: Rules | undefined,
  lookupType: RulesLookupHandleLookupType | undefined,
  valueKey: string | string[] | undefined,
  inCall: boolean,
  shape: RulesLookupHandleShape | undefined,
  declarationConstraints: ReferenceRulesLookupDeclarationConstraints | undefined
): RulesLookupHandleReadResult {
  return readDeclarationRulesLookupHandle(
    referenceNode,
    targetRules,
    lookupType,
    valueKey,
    inCall,
    shape,
    declarationConstraints
  );
}

function readFunctionRulesLookupHandle(
  referenceNode: Reference,
  targetRules: Rules | undefined,
  lookupType: RulesLookupHandleLookupType | undefined,
  valueKey: string | string[] | undefined,
  inCall: boolean,
  shape: RulesLookupHandleShape | undefined
): RulesLookupHandleReadResult {
  const handle = readRulesLookupHandleBase(referenceNode, targetRules, lookupType, valueKey, inCall, shape);
  return handle ? readCurrentRulesLookupHandleValue(handle) : undefined;
}

function readCallableRulesLookupHandle(
  referenceNode: Reference,
  targetRules: Rules | undefined,
  lookupType: RulesLookupHandleLookupType | undefined,
  valueKey: string | string[] | undefined,
  inCall: boolean,
  shape: RulesLookupHandleShape | undefined
): RulesLookupHandleReadResult {
  const handle = readRulesLookupHandleBase(referenceNode, targetRules, lookupType, valueKey, inCall, shape);
  return handle ? readCurrentRulesLookupHandleValue(handle) : undefined;
}

function readSourceStaticRulesLookupHandleBase(
  referenceNode: Reference,
  targetRules: Rules | undefined,
  env: RulesLookupAdapterEnv,
  lookupType: RulesLookupHandleLookupType,
  valueKey: string | string[] | undefined
): ReferenceRulesLookupHandle | undefined {
  const handle = referenceNode._rulesLookupHandle;
  if (
    !handle
    || !targetRules
    || !valueKey
    || handle.start !== undefined
    || handle.local !== false
    || handle.ignoreParentScopeStart !== false
    || handle.terminalMixinOnly !== (referenceNode.options.mixinRulesetCallHasArgs === true)
    || env.hasTarget
    || env.semanticFilter
    || env.context.leakyRules === true
    || env.context.searchScope.size !== 0
    || env.readMode !== undefined
    || env.isInterpolatedVariable
    || referenceNode.options.readMode !== undefined
    || referenceNode.options.resolution !== undefined
    || valueKey !== referenceNode.key
  ) {
    return undefined;
  }
  if (
    handle.targetRules !== targetRules
    || !isRulesLookupHandleVersionCurrent(handle, targetRules, lookupType, valueKey)
    || handle.lookupType !== lookupType
    || handle.inCall !== env.inCall
    || handle.valueKey !== valueKey
  ) {
    return undefined;
  }
  return handle;
}

function tryReadSourceStaticDeclarationRulesLookupHandle(
  referenceNode: Reference,
  targetRules: Rules | undefined,
  valueKey: NormalizedLookupKey,
  env: RulesLookupAdapterEnv,
  lookupType: 'declaration' | 'property' | 'variable'
): RulesLookupHandleReadResult {
  const handleValueKey = getStringRulesLookupHandleValueKey(valueKey);
  const handle = readSourceStaticRulesLookupHandleBase(referenceNode, targetRules, env, lookupType, handleValueKey);
  if (!handle || !hasHandleableDeclarationConstraints(referenceNode)) {
    return undefined;
  }
  const declarationConstraints = getRulesLookupHandleDeclarationConstraints(referenceNode);
  const declarationHandle = handle
    ? readDeclarationRulesLookupHandleConstraints(handle, declarationConstraints)
    : undefined;
  if (!declarationHandle) {
    return undefined;
  }
  return readCurrentRulesLookupHandleValue(declarationHandle);
}

function tryReadSourceStaticFunctionRulesLookupHandle(
  referenceNode: Reference,
  targetRules: Rules | undefined,
  valueKey: NormalizedLookupKey,
  env: RulesLookupAdapterEnv
): RulesLookupHandleReadResult {
  const handleValueKey = getStringRulesLookupHandleValueKey(valueKey);
  const handle = readSourceStaticRulesLookupHandleBase(referenceNode, targetRules, env, 'function', handleValueKey);
  return handle ? readCurrentRulesLookupHandleValue(handle) : undefined;
}

function tryReadSourceStaticMixinRulesLookupHandle(
  referenceNode: Reference,
  targetRules: Rules | undefined,
  valueKey: NormalizedLookupKey,
  env: RulesLookupAdapterEnv
): RulesLookupHandleReadResult {
  const handleValueKey = getCallableRulesLookupHandleValueKey(valueKey);
  const handle = readSourceStaticRulesLookupHandleBase(referenceNode, targetRules, env, 'mixin', handleValueKey);
  return handle ? readCurrentRulesLookupHandleValue(handle) : undefined;
}

function tryReadSourceStaticMixinRulesetRulesLookupHandle(
  referenceNode: Reference,
  targetRules: Rules | undefined,
  valueKey: NormalizedLookupKey,
  env: RulesLookupAdapterEnv
): RulesLookupHandleReadResult {
  const handleValueKey = getCallableRulesLookupHandleValueKey(valueKey);
  const handle = readSourceStaticRulesLookupHandleBase(referenceNode, targetRules, env, 'mixin-ruleset', handleValueKey);
  return handle ? readCurrentRulesLookupHandleValue(handle) : undefined;
}

function tryReadSourceStaticPropertyRulesLookupHandle(
  referenceNode: Reference,
  targetRules: Rules | undefined,
  valueKey: NormalizedLookupKey,
  env: RulesLookupAdapterEnv
): RulesLookupHandleReadResult {
  return tryReadSourceStaticDeclarationRulesLookupHandle(referenceNode, targetRules, valueKey, env, 'property');
}

function tryReadSourceStaticVariableRulesLookupHandle(
  referenceNode: Reference,
  targetRules: Rules | undefined,
  valueKey: NormalizedLookupKey,
  env: RulesLookupAdapterEnv
): RulesLookupHandleReadResult {
  return tryReadSourceStaticDeclarationRulesLookupHandle(referenceNode, targetRules, valueKey, env, 'variable');
}

function tryReadSourceStaticAnyDeclarationRulesLookupHandle(
  referenceNode: Reference,
  targetRules: Rules | undefined,
  valueKey: NormalizedLookupKey,
  env: RulesLookupAdapterEnv
): RulesLookupHandleReadResult {
  return tryReadSourceStaticDeclarationRulesLookupHandle(referenceNode, targetRules, valueKey, env, 'declaration');
}

function writeVariableRulesLookupHandle(
  referenceNode: Reference,
  targetRules: Rules | undefined,
  lookupType: RulesLookupHandleLookupType | undefined,
  valueKey: string | string[] | undefined,
  inCall: boolean,
  shape: RulesLookupHandleShape | undefined,
  returnVal: ReferenceLookupReturnValue,
  declarationConstraints: ReferenceRulesLookupDeclarationConstraints | undefined
): void {
  if (!targetRules || !lookupType || !valueKey || !shape || !declarationConstraints) {
    referenceNode._rulesLookupHandle = undefined;
    return;
  }
  const { start, local, ignoreParentScopeStart, terminalMixinOnly } = shape;
  if (
    lookupType !== 'variable'
    || (
      returnVal !== undefined
      && !isScopeFrameVariableBindingHandle(returnVal)
      && !isDirectDeclarationOccurrence(returnVal)
    )
    || (
      isDirectDeclarationOccurrence(returnVal)
      && returnVal.ownerRules !== targetRules
    )
  ) {
    referenceNode._rulesLookupHandle = undefined;
    return;
  }
  const currentBindingFact = isDirectDeclarationOccurrence(returnVal)
    ? getAncestorVariableCurrentBindingFacts(targetRules, getLookupKeyString(valueKey), returnVal)
    : undefined;
  if (isDirectDeclarationOccurrence(returnVal) && !currentBindingFact) {
    referenceNode._rulesLookupHandle = undefined;
    return;
  }
  const targetLookupVersion = getRulesLookupHandleVersion(targetRules, lookupType, valueKey);
  referenceNode._rulesLookupHandle = {
    targetRules,
    targetLookupVersion,
    valueKey,
    requiredDeclarationAssignmentsKey: declarationConstraints.requiredDeclarationAssignmentsKey,
    excludedDeclaration0: declarationConstraints.excludedDeclaration0,
    excludedDeclaration1: declarationConstraints.excludedDeclaration1,
    currentBindingKey: currentBindingFact?.currentBindingKey,
    currentBindingFrame: currentBindingFact?.currentBindingFrame,
    currentBindingVersion: currentBindingFact?.currentBindingVersion,
    currentBindingRestFrames: currentBindingFact?.currentBindingRestFrames,
    currentBindingRestVersions: currentBindingFact?.currentBindingRestVersions,
    lookupType: 'variable',
    inCall,
    start,
    local,
    ignoreParentScopeStart,
    terminalMixinOnly,
    returnVal: returnVal ?? CACHED_RULES_LOOKUP_MISS
  };
}

function writeDeclarationRulesLookupHandle(
  referenceNode: Reference,
  targetRules: Rules | undefined,
  lookupType: RulesLookupHandleLookupType | undefined,
  valueKey: string | string[] | undefined,
  inCall: boolean,
  shape: RulesLookupHandleShape | undefined,
  returnVal: ReferenceLookupReturnValue,
  declarationConstraints: ReferenceRulesLookupDeclarationConstraints | undefined
): void {
  if (
    !targetRules
    || !lookupType
    || !valueKey
    || !shape
    || !declarationConstraints
    || (lookupType !== 'property' && lookupType !== 'declaration')
    || (returnVal !== undefined && !isDirectDeclarationOccurrence(returnVal))
  ) {
    referenceNode._rulesLookupHandle = undefined;
    return;
  }
  const targetLookupVersion = getRulesLookupHandleVersion(targetRules, lookupType, valueKey);
  const { start, local, ignoreParentScopeStart, terminalMixinOnly } = shape;
  referenceNode._rulesLookupHandle = {
    targetRules,
    targetLookupVersion,
    valueKey,
    requiredDeclarationAssignmentsKey: declarationConstraints.requiredDeclarationAssignmentsKey,
    excludedDeclaration0: declarationConstraints.excludedDeclaration0,
    excludedDeclaration1: declarationConstraints.excludedDeclaration1,
    lookupType,
    inCall,
    start,
    local,
    ignoreParentScopeStart,
    terminalMixinOnly,
    returnVal: returnVal ?? CACHED_RULES_LOOKUP_MISS
  };
}

function writeFunctionRulesLookupHandle(
  referenceNode: Reference,
  targetRules: Rules | undefined,
  lookupType: RulesLookupHandleLookupType | undefined,
  valueKey: string | string[] | undefined,
  inCall: boolean,
  shape: RulesLookupHandleShape | undefined,
  returnVal: ReferenceLookupReturnValue
): void {
  if (
    !targetRules
    || lookupType !== 'function'
    || !valueKey
    || !shape
    || (returnVal !== undefined && !isNode(returnVal, N.Func | N.JsFunction))
  ) {
    referenceNode._rulesLookupHandle = undefined;
    return;
  }
  const targetLookupVersion = getRulesLookupHandleVersion(targetRules, lookupType, valueKey);
  const { start, local, ignoreParentScopeStart, terminalMixinOnly } = shape;
  referenceNode._rulesLookupHandle = {
    targetRules,
    targetLookupVersion,
    valueKey,
    lookupType: 'function',
    inCall,
    start,
    local,
    ignoreParentScopeStart,
    terminalMixinOnly,
    returnVal: returnVal ?? CACHED_RULES_LOOKUP_MISS
  };
}

function writeCallableRulesLookupHandle(
  referenceNode: Reference,
  targetRules: Rules | undefined,
  lookupType: RulesLookupHandleLookupType | undefined,
  valueKey: string | string[] | undefined,
  inCall: boolean,
  shape: RulesLookupHandleShape | undefined,
  returnVal: ReferenceLookupReturnValue
): void {
  if (
    !targetRules
    || !valueKey
    || !shape
    || (lookupType !== 'mixin' && lookupType !== 'mixin-ruleset')
    || (!Array.isArray(returnVal) && returnVal !== undefined)
  ) {
    referenceNode._rulesLookupHandle = undefined;
    return;
  }
  const targetLookupVersion = getRulesLookupHandleVersion(targetRules, lookupType, valueKey);
  const { start, local, ignoreParentScopeStart, terminalMixinOnly } = shape;
  referenceNode._rulesLookupHandle = {
    targetRules,
    targetLookupVersion,
    valueKey,
    lookupType,
    inCall,
    start,
    local,
    ignoreParentScopeStart,
    terminalMixinOnly,
    returnVal: returnVal ?? CACHED_RULES_LOOKUP_MISS
  };
}

function writeStrategyRulesLookupHandle(
  strategy: ReferenceHandleLookupStrategy,
  referenceNode: Reference,
  targetRules: Rules,
  lookupType: RulesLookupHandleLookupType | undefined,
  valueKey: string | string[] | undefined,
  inCall: boolean,
  shape: RulesLookupHandleShape | undefined,
  declarationConstraints: ReferenceRulesLookupDeclarationConstraints | undefined,
  returnVal: ReferenceLookupReturnValue
): void {
  if (isReferenceDeclarationLookupStrategy(strategy)) {
    strategy.writeHandle(
      referenceNode,
      targetRules,
      lookupType,
      valueKey,
      inCall,
      shape,
      returnVal,
      declarationConstraints
    );
    return;
  }
  strategy.writeHandle(
    referenceNode,
    targetRules,
    lookupType,
    valueKey,
    inCall,
    shape,
    returnVal
  );
}

const INDEX_REFERENCE_LOOKUP_STRATEGY: ReferenceLookupStrategy = {
  lookupType: 'index',
  performRulesLookup: performIndexRulesLookup
};
const PROPERTY_REFERENCE_LOOKUP_STRATEGY: ReferenceLookupStrategy = {
  lookupType: 'property',
  handleLookupType: 'property',
  performRulesLookup: performPropertyRulesLookup,
  readHandle: readDeclarationRulesLookupHandle,
  writeHandle: writeDeclarationRulesLookupHandle,
  getHandleValueKey: getStringRulesLookupHandleValueKey,
  getHandleDeclarationConstraints: getHandleableDeclarationConstraints,
  tryReadSourceStaticHandle: tryReadSourceStaticPropertyRulesLookupHandle
};
const VARIABLE_REFERENCE_LOOKUP_STRATEGY: ReferenceLookupStrategy = {
  lookupType: 'variable',
  handleLookupType: 'variable',
  performRulesLookup: performVariableRulesLookup,
  readHandle: readVariableRulesLookupHandle,
  writeHandle: writeVariableRulesLookupHandle,
  getHandleValueKey: getStringRulesLookupHandleValueKey,
  getHandleDeclarationConstraints: getHandleableDeclarationConstraints,
  tryReadSourceStaticHandle: tryReadSourceStaticVariableRulesLookupHandle
};
const DECLARATION_REFERENCE_LOOKUP_STRATEGY: ReferenceLookupStrategy = {
  lookupType: 'declaration',
  handleLookupType: 'declaration',
  performRulesLookup: performDeclarationRulesLookup,
  readHandle: readDeclarationRulesLookupHandle,
  writeHandle: writeDeclarationRulesLookupHandle,
  getHandleValueKey: getStringRulesLookupHandleValueKey,
  getHandleDeclarationConstraints: getHandleableDeclarationConstraints,
  tryReadSourceStaticHandle: tryReadSourceStaticAnyDeclarationRulesLookupHandle
};
const FUNCTION_REFERENCE_LOOKUP_STRATEGY: ReferenceLookupStrategy = {
  lookupType: 'function',
  handleLookupType: 'function',
  performRulesLookup: performFunctionRulesLookup,
  readHandle: readFunctionRulesLookupHandle,
  writeHandle: writeFunctionRulesLookupHandle,
  getHandleValueKey: getStringRulesLookupHandleValueKey,
  tryReadSourceStaticHandle: tryReadSourceStaticFunctionRulesLookupHandle
};
const MIXIN_REFERENCE_LOOKUP_STRATEGY: ReferenceLookupStrategy = {
  lookupType: 'mixin',
  handleLookupType: 'mixin',
  performRulesLookup: performMixinRulesLookup,
  readHandle: readCallableRulesLookupHandle,
  writeHandle: writeCallableRulesLookupHandle,
  getHandleValueKey: getCallableRulesLookupHandleValueKey,
  tryReadSourceStaticHandle: tryReadSourceStaticMixinRulesLookupHandle
};
const MIXIN_RULESET_REFERENCE_LOOKUP_STRATEGY: ReferenceLookupStrategy = {
  lookupType: 'mixin-ruleset',
  handleLookupType: 'mixin-ruleset',
  performRulesLookup: performMixinRulesetRulesLookup,
  readHandle: readCallableRulesLookupHandle,
  writeHandle: writeCallableRulesLookupHandle,
  getHandleValueKey: getCallableRulesLookupHandleValueKey,
  tryReadSourceStaticHandle: tryReadSourceStaticMixinRulesetRulesLookupHandle
};

function getReferenceLookupStrategy(lookupType: LookupType): ReferenceLookupStrategy {
  switch (lookupType) {
    case 'index':
      return INDEX_REFERENCE_LOOKUP_STRATEGY;
    case 'property':
      return PROPERTY_REFERENCE_LOOKUP_STRATEGY;
    case 'variable':
      return VARIABLE_REFERENCE_LOOKUP_STRATEGY;
    case 'declaration':
      return DECLARATION_REFERENCE_LOOKUP_STRATEGY;
    case 'function':
      return FUNCTION_REFERENCE_LOOKUP_STRATEGY;
    case 'mixin':
      return MIXIN_REFERENCE_LOOKUP_STRATEGY;
    case 'mixin-ruleset':
      return MIXIN_RULESET_REFERENCE_LOOKUP_STRATEGY;
  }
}

function isReferenceDeclarationLookupStrategy(
  strategy: ReferenceHandleLookupStrategy
): strategy is ReferenceDeclarationLookupStrategy {
  switch (strategy.lookupType) {
    case 'declaration':
    case 'property':
    case 'variable':
      return true;
    case 'function':
    case 'mixin':
    case 'mixin-ruleset':
      return false;
  }
}

function isReferenceHandleLookupStrategy(
  strategy: ReferenceLookupStrategy
): strategy is ReferenceHandleLookupStrategy {
  switch (strategy.lookupType) {
    case 'declaration':
    case 'property':
    case 'variable':
    case 'function':
    case 'mixin':
    case 'mixin-ruleset':
      return true;
    case 'index':
      return false;
  }
}

function getCachedReferenceLookupStrategy(
  referenceNode: Reference,
  lookupType: LookupType
): ReferenceLookupStrategy {
  const cached = referenceNode._lookupStrategy;
  if (cached?.lookupType === lookupType) {
    return cached;
  }
  const strategy = getReferenceLookupStrategy(lookupType);
  referenceNode._lookupStrategy = strategy;
  return strategy;
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
  returnVal: ReferenceLookupReturnValue;
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
  const targetRules = isNode(resolvedTarget, N.Rules) ? resolvedTarget : undefined;
  const uncachedStrategy = getReferenceLookupStrategy(lookupType);
  const uncachedHandleStrategy = isReferenceHandleLookupStrategy(uncachedStrategy)
    ? uncachedStrategy
    : undefined;
  const { env } = prepareReferenceLookup({
    referenceNode,
    lookupType,
    keyNode: referenceNode.key,
    target,
    originalFilter,
    context
  });
  if (uncachedHandleStrategy) {
    const sourceStaticHandleResult = uncachedHandleStrategy.tryReadSourceStaticHandle(
      referenceNode,
      targetRules,
      valueKey,
      env
    );
    if (sourceStaticHandleResult !== undefined) {
      return {
        returnVal: sourceStaticHandleResult === CACHED_RULES_LOOKUP_MISS ? undefined : sourceStaticHandleResult,
        valueKey
      };
    }
  }
  const strategy = getCachedReferenceLookupStrategy(referenceNode, lookupType);
  const handleStrategy = isReferenceHandleLookupStrategy(strategy)
    ? strategy
    : undefined;

  const lookupContext: RulesReferenceLookupContext = {
    referenceNode,
    lookupType,
    strategy,
    target,
    resolution: referenceNode.options.resolution,
    isInterpolatedVariable: env.isInterpolatedVariable,
    filter: env.filter,
    semanticFilter: env.semanticFilter,
    context,
    hasTarget: env.hasTarget,
    valueKey,
    env
  };

  let handleShape: RulesLookupHandleShape | undefined;
  let handleDeclarationConstraints: ReferenceRulesLookupDeclarationConstraints | undefined;
  let handleLookupType: RulesLookupHandleLookupType | undefined;
  let handleValueKey: string | string[] | undefined;
  if (targetRules && handleStrategy) {
    handleShape = prepareRulesLookupShape(lookupContext, targetRules);
    handleValueKey = getStrategyRulesLookupHandleValueKey({
      strategy: handleStrategy,
      valueKey,
      target,
      originalFilter,
      env,
      context
    });
    if (handleValueKey !== undefined) {
      if (isReferenceDeclarationLookupStrategy(handleStrategy)) {
        handleDeclarationConstraints = handleStrategy.getHandleDeclarationConstraints(referenceNode);
        if (handleDeclarationConstraints !== undefined) {
          handleLookupType = handleStrategy.handleLookupType;
        } else {
          handleValueKey = undefined;
        }
      } else {
        handleLookupType = handleStrategy.handleLookupType;
      }
    }
    const handleResult = isReferenceDeclarationLookupStrategy(handleStrategy)
      ? handleStrategy.readHandle(
          referenceNode,
          targetRules,
          handleLookupType,
          handleValueKey,
          env.inCall,
          handleShape,
          handleDeclarationConstraints
        )
      : handleStrategy.readHandle(
          referenceNode,
          targetRules,
          handleLookupType,
          handleValueKey,
          env.inCall,
          handleShape
        );
    if (handleResult !== undefined) {
      return {
        returnVal: handleResult === CACHED_RULES_LOOKUP_MISS ? undefined : handleResult,
        valueKey
      };
    }
  } else if (targetRules) {
    referenceNode._rulesLookupHandle = undefined;
  }

  const returnVal = lookupReferenceTarget({
    resolvedTarget: isNode(resolvedTarget) ? resolvedTarget : undefined,
    lookupType,
    valueKey,
    context,
    rulesParent: referenceNode.rulesParent,
    sourceRulesParent: referenceNode.sourceRulesParent,
    lookupContext
  });

  if (isThenable(returnVal)) {
    return Promise.resolve(returnVal).then((resolved) => {
      if (targetRules && handleStrategy) {
        writeStrategyRulesLookupHandle(
          handleStrategy,
          referenceNode,
          targetRules,
          handleLookupType,
          handleValueKey,
          env.inCall,
          handleShape,
          handleDeclarationConstraints,
          resolved
        );
      }
      return {
        returnVal: resolved,
        valueKey
      };
    });
  }
  if (targetRules && handleStrategy) {
    writeStrategyRulesLookupHandle(
      handleStrategy,
      referenceNode,
      targetRules,
      handleLookupType,
      handleValueKey,
      env.inCall,
      handleShape,
      handleDeclarationConstraints,
      returnVal
    );
  }
  return { returnVal, valueKey };
}

function tryReadInitialSourceStaticRulesLookupHandle(args: {
  referenceNode: Reference;
  lookupType: LookupType;
  key: ReferenceValue['key'];
  target: ReferenceValue['target'];
  originalFilter: ReferenceOptions['filter'] | undefined;
  context: Context;
}): {
  returnVal: ReferenceLookupReturnValue;
  valueKey: NormalizedLookupKey;
} | undefined {
  const {
    referenceNode,
    lookupType,
    key,
    target,
    originalFilter,
    context
  } = args;
  if (target !== undefined || referenceNode._rulesLookupHandle === undefined) {
    return undefined;
  }
  const valueKey = getStaticReferenceValueKey(key);
  if (valueKey === undefined) {
    return undefined;
  }
  const targetRules = context.rulesContext ?? referenceNode.rulesParent;
  if (!isNode(targetRules, N.Rules)) {
    return undefined;
  }
  const strategy = getReferenceLookupStrategy(lookupType);
  const handleStrategy = isReferenceHandleLookupStrategy(strategy)
    ? strategy
    : undefined;
  if (!handleStrategy) {
    return undefined;
  }
  const { env } = prepareReferenceLookup({
    referenceNode,
    lookupType,
    keyNode: referenceNode.key,
    target,
    originalFilter,
    context
  });
  const handleResult = handleStrategy.tryReadSourceStaticHandle(
    referenceNode,
    targetRules,
    valueKey,
    env
  );
  if (handleResult === undefined) {
    return undefined;
  }
  return {
    returnVal: handleResult === CACHED_RULES_LOOKUP_MISS ? undefined : handleResult,
    valueKey
  };
}

function lookupDirectTarget(
  targetNode: Node | undefined,
  lookupType: LookupType,
  valueKey: NormalizedLookupKey
): DirectTargetReferenceLookupReturnValue {
  if (lookupType !== 'index' || !targetNode) {
    return undefined;
  }
  if (typeof valueKey === 'number') {
    return lookupDirectArrayIndexTarget(targetNode, valueKey);
  }
  return lookupDirectNamedTarget(targetNode, getLookupKeyString(valueKey));
}

function lookupDirectArrayIndexTarget(
  targetNode: Node,
  valueKey: number
): DirectTargetReferenceLookupReturnValue {
  if (!(targetNode instanceof JsArray)) {
    return undefined;
  }
  return atIndex(targetNode.value, valueKey);
}

function lookupDirectNamedTarget(
  targetNode: Node,
  key: string
): DirectTargetReferenceLookupReturnValue {
  if (targetNode instanceof JsObject) {
    return targetNode.value[key];
  }
  return undefined;
}

function getReferenceNotFoundError(type: LookupType, keyDisplay: string): ReferenceError {
  if (type === 'mixin' || type === 'mixin-ruleset') {
    return new ReferenceError(`No matching mixins found for '${keyDisplay}'`);
  }
  return new ReferenceError(`'${keyDisplay}' is not defined`);
}

function normalizeReferenceKeyValue(value: unknown): NormalizedLookupKey {
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  if (isNode(value, N.Any | N.Keyword)) {
    return value.value;
  }
  if (isNode(value, N.Quoted) && typeof value.value === 'string') {
    return value.value;
  }
  if (isNode(value, N.Num | N.Dimension)) {
    return value.unit ? `${value.number}${value.unit}` : value.number;
  }
  if (isNode(value, N.Color) && typeof value.node === 'string') {
    return value.node;
  }
  if (isNode(value)) {
    const normalizedKey = value.valueOf();
    return typeof normalizedKey === 'string' || typeof normalizedKey === 'number'
      ? normalizedKey
      : String(normalizedKey);
  }
  return String(value);
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
        const normalizedPart = normalizeReferenceKeyValue(resolvedKey[i]);
        normalized[i] = typeof normalizedPart === 'number'
          ? `${normalizedPart}`
          : normalizedPart;
      }
      return [resolvedTarget, normalized];
    }
    return [resolvedTarget, normalizeReferenceKeyValue(resolvedKey)];
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
  const { target } = referenceNode;
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
  const runtimeKey = referenceNode.rawKey ?? referenceNode.key;
  let runtimeLiveSlotKey: string | undefined;
  if (typeof runtimeKey === 'string') {
    runtimeLiveSlotKey = runtimeKey;
  } else if (typeof runtimeKey === 'number') {
    runtimeLiveSlotKey = String(runtimeKey);
  }
  const runtimeParentHasLiveSlot = runtimeLiveSlotKey !== undefined
    && runtimeRulesParent?._scopeFrame?.currentBindingsByName.get(runtimeLiveSlotKey)?.live === true;
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
    && referenceNode.target !== undefined
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
    ? String((resolvedTarget as Color).node)
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
    const refNode = new Reference(
      targetKey,
      { type: 'mixin-ruleset' },
      undefined,
      referenceNode.sourceRoot?._treeContext
    );
    referenceNode.adopt(refNode);
    return refNode.eval(context);
  }
  return resolvedTarget;
}

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
    const jsResult = (resolvedTarget as JsFunction).fn.call(context);
    if (isThenable(jsResult)) {
      return Promise.resolve(jsResult).then(result => [result, valueKey]);
    }
    return [jsResult, valueKey];
  }
  if (isNode(resolvedTarget, N.Mixin)) {
    const sourceRules = resolvedTarget.rules;
    const mixinResult = sourceRules.eval(context);
    if (isThenable(mixinResult)) {
      return Promise.resolve(mixinResult).then(rules => [rules, valueKey]);
    }
    return [mixinResult, valueKey];
  }
  if (isNode(resolvedTarget, N.Ruleset)) {
    const sourceRules = resolvedTarget.rules;
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

function isEmptyMergedAssignPlaceholder(node: Node): boolean {
  if (node instanceof Nil) {
    return true;
  }
  if (isNode(node, N.Any | N.Keyword)) {
    return node.value === '';
  }
  if (isNode(node, N.Quoted) && typeof node.value === 'string') {
    return node.value === '';
  }
  return String(node.valueOf?.() ?? '') === '';
}

function canReturnMergedAssignReferenceValue(node: Node): boolean {
  if (!canReturnReferenceValue(node)) {
    return false;
  }
  if (!(node instanceof List)) {
    return true;
  }
  for (let i = 0; i < node.items.length; i++) {
    const child = node.items[i]!;
    if (child instanceof List || isEmptyMergedAssignPlaceholder(child)) {
      return false;
    }
  }
  return true;
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
  const descriptors = Object.getOwnPropertyDescriptors(directValue);
  const optionsDescriptor = descriptors._options;
  if (
    optionsDescriptor
    && 'value' in optionsDescriptor
    && optionsDescriptor.value
    && typeof optionsDescriptor.value === 'object'
  ) {
    optionsDescriptor.value = { ...optionsDescriptor.value };
  }
  delete descriptors.sourceNode;
  delete descriptors.parent;
  delete descriptors.index;
  const preservedValue = Object.create(
    Object.getPrototypeOf(directValue)
  );
  if (!(preservedValue instanceof Node)) {
    throw new TypeError('Preserved rules-like value must remain a Node');
  }
  Object.defineProperties(preservedValue, descriptors);
  const sourceNode = directValue.sourceNode instanceof Node ? directValue.sourceNode : directValue;
  Object.defineProperties(preservedValue, {
    sourceNode: {
      value: directValue,
      writable: true,
      enumerable: false,
      configurable: false
    },
    parent: {
      value: directValue.parent ?? sourceNode.parent,
      writable: true,
      enumerable: false,
      configurable: true
    },
    index: {
      value: directValue.index ?? sourceNode.index,
      writable: true,
      enumerable: true,
      configurable: true
    }
  });
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
    return new Any(`${valueKey}`, { role: referenceNode.role });
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

function finalizeScopeFrameVariableBindingResult(
  referenceNode: Reference,
  binding: ScopeFrameVariableBindingHandle,
  context: Context
): MaybePromise<Node> {
  const bindingSource = binding.sourceNode;
  const bindingValue = getBindingHandleValue(binding);
  const bindingRulesContext = getBindingHandleRulesContext(binding);
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
      && isNode(bindingValue, N.Rules | N.Collection)
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
  const evaluatedBinding = evaluateBindingHandleValue(
    bindingValue,
    bindingSource,
    bindingRulesContext,
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

function evaluateBindingHandleValue(
  bindingValue: Node,
  bindingSource: Node | undefined,
  bindingRulesContext: Rules | undefined,
  context: Context,
  evalFlags: number,
  useDefinitionRulesContext: boolean
): MaybePromise<Node> {
  const savedRulesContext = context.rulesContext;
  let changedRulesContext = false;
  if (useDefinitionRulesContext && bindingSource) {
    context.rulesContext = bindingRulesContext ?? bindingSource.rulesParent ?? context.rulesContext;
    changedRulesContext = true;
  }
  if (bindingSource) {
    context.searchScope.add(bindingSource);
  }

  try {
    const result = evaluateReferenceValueNode(bindingValue, context, evalFlags);
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
  const declarationValue = declaration.valueNode;
  let isMergedAssign = false;
  let hasImportant = false;
  if (isNode(declaration, N.Declaration)) {
    hasImportant = !!declaration.important;
    const normalizedAssign = declaration.options?.normalizedFromAssign;
    isMergedAssign = normalizedAssign === '+:' || normalizedAssign === '&,:' || normalizedAssign === '&_:';
  }
  if (
    context.calcFrames === 0
    && !hasImportant
    && (
      (!isMergedAssign && canReturnReferenceValue(declarationValue))
      || (isMergedAssign && canReturnMergedAssignReferenceValue(declarationValue))
    )
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
      context.pushImportantSource(declaration.important);
      importantPushed = true;
    }
    const evaluated = evaluateReferenceValueNode(declarationValue, context);
    const finalize = (evaluatedNode: Node): Node => {
      if (!isMergedAssign) {
        popReference();
        return evaluatedNode;
      }
      if (canReturnMergedAssignReferenceValue(evaluatedNode)) {
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
      for (const item of child.items) {
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

  for (let i = 0; i < node.items.length; i++) {
    const child = node.items[i]!;
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
        mergedItems.push(node.items[j]!);
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
  returnVal: ReferenceLookupReturnValue | unknown,
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
  if (isScopeFrameVariableBindingHandle(returnVal)) {
    return finalizeScopeFrameVariableBindingResult(referenceNode, returnVal, context);
  }
  if (isDirectDeclarationOccurrence(returnVal)) {
    return finalizeDeclarationReferenceResult(referenceNode, returnVal.node, context);
  }
  if (isNode(returnVal, N.Declaration) || isNode(returnVal, N.VarDeclaration)) {
    return finalizeDeclarationReferenceResult(referenceNode, returnVal, context);
  }
  return finalizeDirectReferenceResult(referenceNode, returnVal, context);
}

function finalizeRawReferenceLookupTarget(
  returnVal: ReferenceLookupReturnValue | unknown
): unknown {
  if (returnVal === undefined) {
    return RAW_REFERENCE_TARGET_NOT_FOUND;
  }
  if (isScopeFrameVariableBindingHandle(returnVal)) {
    return getBindingHandleValue(returnVal);
  }
  if (isDirectDeclarationOccurrence(returnVal)) {
    return returnVal.node.valueNode;
  }
  if (isNode(returnVal, N.Declaration) || isNode(returnVal, N.VarDeclaration)) {
    return returnVal.valueNode;
  }
  return returnVal;
}

function resolveRawReferenceLookupTarget(
  referenceNode: Reference,
  context: Context
): MaybePromise<unknown> {
  const { target, key } = referenceNode;
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
    && referenceNode.target === undefined
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
  options: FinalPrintOptions
): void {
  const w = options.writer!;
  if (typeof key === 'string' || typeof key === 'number') {
    w.add(String(key), referenceNode);
    return;
  }
  if (key instanceof Node) {
    key.writeSyntax(options);
    return;
  }
  if (Array.isArray(key)) {
    for (let i = 0; i < key.length; i++) {
      w.add(String(key[i]));
    }
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
  const initialHandleLookup = tryReadInitialSourceStaticRulesLookupHandle({
    referenceNode,
    lookupType,
    key,
    target,
    originalFilter,
    context
  });
  if (initialHandleLookup !== undefined) {
    const { returnVal, valueKey } = initialHandleLookup;
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
  }
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
  static override childKeys = ['target', 'key'] as const;

  _rulesLookupHandle: ReferenceRulesLookupHandle | undefined;
  _lookupStrategy: ReferenceLookupStrategy | undefined;
  readonly target: ReferenceValue['target'];
  readonly key: ReferenceValue['key'];
  readonly rawKey: ReferenceValue['rawKey'];
  readonly role: AnyRole | undefined;

  constructor(
    value: ReferenceValue | string,
    options?: ReferenceOptions,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    if (typeof value === 'string') {
      value = { key: value };
    }
    super(value, options, location);
    this._treeContext = treeContext;
    this.target = value.target;
    this.key = value.key;
    this.rawKey = value.rawKey;
    this.role = options?.role;
    // References are always non-static and may be async
    this.addFlags(F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC);
  }

  override valueOf() {
    return '';
  }

  private writeReferenceSyntax(options: FinalPrintOptions): void {
    const w = options.writer!;
    let { type = 'variable', resolution, fallbackValue, readMode } = this.options;
    let { target, key } = this;
    const { rawKey } = this;
    const printableKey = rawKey ?? key;
    if (target) {
      target.writeSyntax(options);
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
  }

  override writeSyntax(options: FinalPrintOptions): void {
    this.writeReferenceSyntax(options);
  }

  /**
   * @note - A reference renders a $ only if it has no target.
   */
  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    this.writeSyntax(options);
    return w.getSince(mark);
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
            target: this.target,
            key: this.key,
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
      target: this.target,
      key: this.key,
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
    let { target, key } = this;
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
