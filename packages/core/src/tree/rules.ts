import {
  Node,
  defineType,
  type NodeOptions,
  type LocationInfo,
  type TreeContext,
  F_STATIC,
  F_VISIBLE
} from './node.js';
import { Context } from '../context.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { Ruleset } from './ruleset.js';
import { type Mixin } from './mixin.js';
import type { Selector } from './selector.js';
import { spaced, Sequence } from './sequence.js';
import {
  OutputWriter,
  type FinalPrintOptions,
  type PrintOptions,
  getPrintOptions,
  prepareRenderPrintState,
  savePrintState,
  restorePrintState
} from './util/print.js';

import {
  getOrderedSelectorKeys,
  isNonClassicImportBoundary,
  type CallableFindOptions,
  type DeclarationFindOptions
} from './util/lookup-utils.js';
import { processExtends } from './util/extend-roots.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { Nil } from './nil.js';
import { VarDeclaration } from './declaration-var.js';
import type { Declaration } from './declaration.js';
import { List } from './list.js';
import {
  indent,
  normalizeBlockTrivia,
  normalizeIndent,
  serializeRulesContainerInline,
  hasPrintableTriviaAt
} from './util/serialize-helper.js';
import type { AtRule } from './at-rule.js';
import type { StyleImport } from './import-style.js';
import {
  assignScopeFrameVariable,
  buildScopeFrame,
  copyScopeFrameLiveBindingSlots,
  createVarDeclarationBindingEntry,
  lookupScopeFrameCallable,
  lookupScopeFrameVariable,
  setScopeFrameDeclarationBinding,
  type BindingCell,
  type BindingEntry,
  type ScopeFrame,
  type ScopeFrameCallableLookupResult
} from './scope-frame.js';
import { consumeTriviaText } from './util/trivia.js';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  type RenderBuffer,
  writeRenderText
} from './util/render-buffer.js';
import type { JsFunction } from './js-function.js';
import type { Func } from './function.js';
import {
  blocksAmbientMixinOutputLookup,
  canEnterMixinOutputForLookup,
  canEnterRulesEntryForLookup,
  getMixinOutputChildForSource,
  isHiddenMixinOutputChild,
  isOptionalRulesEntry,
  isPublicRulesEntry,
  type RulesEntryLike
} from './util/mixin-output-slot.js';
import type { MixinOutputSlot } from './util/mixin-output-slot.js';
import { isPlainObject } from './util/collections.js';
import { canRenderStaticRulesDirectly } from './util/static-rules.js';
import {
  type CallableEntry,
  type CallableNamespaceGuard,
  callableRulesEntry,
  getCallableEntryGuard,
  getCallableEntryName,
  getCallableEntryNamespaceGuards,
  getCallableEntryParams,
  getMixinEntryRules,
  isCallableEntry,
  type CallableLookupEntry,
  type MixinEntry
} from './util/callable-entry.js';
import { isIndexedRuleChild } from './util/callable-surface.js';
import { queueTopImport } from './util/import-queue.js';
import {
  findWritableSetDefinedDeclarationOccurrence,
  type DirectDeclarationOccurrence
} from './util/direct-rules-lookup.js';
import { comparePosition } from './util/compare.js';
const { isArray } = Array;
const NESTABLE_AT_RULE_NAMES = new Set(['@media', '@supports', '@layer', '@container', '@scope']);
const MAX_DECLARATION_NAME_REGISTRATION_RETRIES = 5;
type PathResolutionError = Error & { _isPathResolutionError?: boolean };
type FlagLikeNode = { hasFlag(flag: number): boolean };
type PendingPrepHandler = (resolvedNode: Node, node: Node, stillUnresolved: Node[]) => boolean;
type RulesRenderContextSnapshot = {
  rulesContext: Context['rulesContext'];
  treeContext: Context['treeContext'];
  treeRoot: Context['treeRoot'];
  root: Context['root'];
  extendRootStackLength: number;
};
type RulesRenderState = {
  source: Rules;
  output: Rules;
  sourceWasRoot: boolean;
  directSourceContext?: RulesRenderContextSnapshot;
  restoreContext?: RulesRenderContextSnapshot;
  kind: 'direct-render';
};
type RulesResolveState = {
  source: Rules;
  output: Rules;
  kind: 'public-resolve';
};

function getWriterTextSincePosition(writer: OutputWriter, position: number): string {
  const chunks = Reflect.get(writer as object, 'chunks');
  if (!Array.isArray(chunks) || position >= chunks.length) {
    return '';
  }
  let out = '';
  for (let i = position; i < chunks.length; i++) {
    out += chunks[i] ?? '';
  }
  return out;
}
type ExactCallableFindOptions = {
  hasTarget?: boolean;
  local?: boolean;
  includeRulesets?: boolean;
  searchParents?: boolean;
  skipCurrentSurface?: boolean;
};
type CallableRulesetPathResult = {
  entries: MixinEntry[];
  owned: boolean;
};
const DEFINITE_MIXIN_NAMESPACE_MISS = Symbol('definite-mixin-namespace-miss');
type CallableNamespaceFastResult = CallableRulesetPathResult | typeof DEFINITE_MIXIN_NAMESPACE_MISS | undefined;
const UNCOVERED_CALLABLE_MISS: MixinEntry[] = [];
const UNCOVERED_CALLABLE_UNSUPPORTED = Symbol('uncovered-callable-unsupported');
type UncoveredCallableResult =
  | MixinEntry[]
  | typeof UNCOVERED_CALLABLE_UNSUPPORTED;

function syncDeclarationValueNode(declaration: Declaration, value: Node): void {
  declaration.value.value = value;
  Object.defineProperty(declaration, 'valueNode', {
    configurable: true,
    enumerable: true,
    writable: true,
    value
  });
  declaration.adopt(value);
}

function isStyleImportRegistrationNode(node: Node): node is StyleImport {
  return node.type === 'StyleImport';
}

function isImportAtRule(node: Node): node is AtRule {
  return isNode(node, N.AtRule)
    && String(node.name.valueOf?.() ?? node.name ?? '').trim() === '@import';
}

function keysStartWith(keys: readonly string[], path: readonly string[]): boolean {
  if (path.length > keys.length) {
    return false;
  }
  for (let i = 0; i < path.length; i++) {
    if (keys[i] !== path[i]) {
      return false;
    }
  }
  return true;
}

function collectKeyRemainder(keys: readonly string[], start: number): string[] {
  const length = keys.length - start;
  const remainder = new Array<string>(length);
  for (let i = 0; i < length; i++) {
    remainder[i] = keys[start + i]!;
  }
  return remainder;
}

function splitStaticCallablePathKey(key: string): string[] | undefined {
  let firstStart = -1;
  let firstEnd = -1;
  let out: string[] | undefined;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    if (char !== 35 && char !== 46) {
      continue;
    }
    const start = i;
    i++;
    while (i < key.length) {
      const next = key.charCodeAt(i);
      if (next === 35 || next === 46) {
        break;
      }
      i++;
    }
    if (i === start + 1) {
      i--;
      continue;
    }
    if (firstStart < 0) {
      firstStart = start;
      firstEnd = i;
      i--;
      continue;
    }
    out ??= [key.slice(firstStart, firstEnd)];
    out.push(key.slice(start, i));
    i--;
  }
  return out;
}

function getCallableRulesetKeyPaths(ruleset: Ruleset): string[][] {
  const selector = ruleset.selector;
  const selectorType = selector.nodeType ?? 0;
  if ((selectorType & N.Nil) !== 0) {
    return [];
  }
  if ((selectorType & N.SelectorList) !== 0) {
    const out: string[][] = [];
    for (let i = 0; i < selector.value.length; i++) {
      const keys = getOrderedSelectorKeys(selector.value[i]!);
      if (keys.length > 0) {
        out.push(keys);
      }
    }
    return out;
  }
  const keys = getOrderedSelectorKeys(selector);
  return keys.length > 0 ? [keys] : [];
}

function isSelectorLikeNode(node: unknown): node is Selector {
  if (!node || typeof node !== 'object') {
    return false;
  }
  const candidate = node as Node;
  return ((candidate.nodeType ?? 0) & N.Selector) !== 0
    || candidate.type === 'InterpolatedSelector';
}

function renderRulesToString(
  source: Rules,
  node: Node,
  context: Context,
  options: PrintOptions | undefined,
  sourceWasRoot: boolean,
  directSourceRender: boolean
): MaybePromise<string> {
  const rendered = renderRulesToPreparedString(
    source,
    node,
    context,
    prepareRenderPrintState(context, options),
    directSourceRender
  );
  const finish = (out: string): string => {
  // Root Rules serialize as a CSS document and own the final newline. Nested
  // direct string render returns a body fragment, so trim only that single
  // trailing rule separator; buffer render preserves the full fragment text.
    if (sourceWasRoot || !out.endsWith('\n')) {
      return out;
    }
    return out.slice(0, -1);
  };
  return isThenable(rendered)
    ? rendered.then(finish)
    : finish(rendered);
}

function renderRulesStateToString(
  state: RulesRenderState,
  context: Context,
  options: PrintOptions | undefined
): MaybePromise<string> {
  const rendered = renderRulesToString(
    state.source,
    state.output,
    context,
    options,
    state.sourceWasRoot,
    Boolean(state.directSourceContext)
  );
  return finishRulesRenderState(rendered, state, context);
}

function createRulesRenderState(
  source: Rules,
  output: Rules,
  sourceWasRoot: boolean,
  directSourceContext?: RulesRenderContextSnapshot,
  restoreContext?: RulesRenderContextSnapshot
): RulesRenderState {
  return {
    source,
    output,
    sourceWasRoot,
    directSourceContext,
    restoreContext,
    kind: 'direct-render'
  };
}

function createRulesResolveState(source: Rules, output: Rules): RulesResolveState {
  return {
    source,
    output,
    kind: 'public-resolve'
  };
}

function writeRulesRenderOutput(
  buffer: RenderBuffer,
  source: Rules,
  node: Node,
  context: Context,
  options: PrintOptions | undefined,
  directSourceRender: boolean
): MaybePromise<string> {
  const prepared = prepareBufferPrintState(context, options);
  const text = node.type === 'Rules' && !directSourceRender
    ? (
        node === context.root || source === context.root
          ? node._toDocumentString(prepared)
          : node.toString(prepared)
      )
    : renderRulesToPreparedString(source, node, context, prepared, directSourceRender);
  return isThenable(text)
    ? text.then(resolved => writeRenderText(buffer, resolved))
    : writeRenderText(buffer, text);
}

function writeRulesStateRenderOutput(
  buffer: RenderBuffer,
  state: RulesRenderState,
  context: Context,
  options: PrintOptions | undefined
): MaybePromise<string> {
  const rendered = writeRulesRenderOutput(
    buffer,
    state.source,
    state.output,
    context,
    options,
    Boolean(state.directSourceContext)
  );
  return finishRulesRenderState(rendered, state, context);
}

function renderRulesToPreparedString(
  source: Rules,
  node: Node,
  context: Context,
  prepared: FinalPrintOptions,
  directSourceRender: boolean
): MaybePromise<string> {
  if (directSourceRender && isNode(node, N.Rules)) {
    if (
      (node === context.root || source === context.root)
      && (context.currentCharset || context.topImports?.length)
    ) {
      return node._toDocumentString(prepared);
    }
    const rendered = node.toRenderString(prepared);
    const finish = (text: string): string => text === '' || text.endsWith('\n') ? text : `${text}\n`;
    return isThenable(rendered)
      ? rendered.then(finish)
      : finish(rendered);
  }
  if (
    isNode(node, N.Rules)
    && (node === context.root || source === context.root)
  ) {
    return node._toDocumentString(prepared);
  }
  return isNode(node, N.Rules)
    ? node.toRenderString(prepared)
    : node.toTrimmedString(prepared);
}

function restoreRulesRenderContext(context: Context, saved: RulesRenderContextSnapshot): void {
  context.rulesContext = saved.rulesContext;
  context.treeContext = saved.treeContext;
  context.treeRoot = saved.treeRoot;
  context.root = saved.root;
  while (context.extendRoots.extendRootStack.length > saved.extendRootStackLength) {
    context.extendRoots.popExtendRoot();
  }
}

function finishRulesRenderState<T extends string>(
  rendered: MaybePromise<T>,
  state: RulesRenderState,
  context: Context
): MaybePromise<T> {
  const saved = state.directSourceContext ?? state.restoreContext;
  if (!saved) {
    return rendered;
  }
  if (isThenable(rendered)) {
    return rendered.then(
      (value) => {
        restoreRulesRenderContext(context, saved);
        return value;
      },
      (error) => {
        restoreRulesRenderContext(context, saved);
        throw error;
      }
    );
  }
  restoreRulesRenderContext(context, saved);
  return rendered;
}

function childRulesOf(node: Node): Rules | undefined {
  const nodeType = node.nodeType ?? 0;
  if ((nodeType & N.Rules) !== 0) {
    return node;
  }
  if ((nodeType & (N.Ruleset | N.AtRule | N.Mixin)) !== 0) {
    return (node as Ruleset | AtRule | Mixin).rules;
  }
  return undefined;
}

function childCallableRulesOf(node: Node): Rules | undefined {
  const nodeType = node.nodeType ?? 0;
  if ((nodeType & N.Rules) !== 0) {
    return node;
  }
  if ((nodeType & (N.Ruleset | N.AtRule)) !== 0) {
    return (node as Ruleset | AtRule).rules;
  }
  return undefined;
}

function hidesAmbientMixinSurface(node: Node): boolean {
  return ((node.nodeType ?? 0) & N.Ruleset) !== 0 && Ruleset.isBareAmpersandSelector(node.selector);
}

function rulesMayContainExactCallableSurface(rules: Rules): boolean {
  const value = rules.rules;
  for (let i = 0; i < value.length; i++) {
    const node = value[i]!;
    if (((node.nodeType ?? 0) & (N.Mixin | N.Ruleset | N.AtRule | N.Rules)) !== 0) {
      return true;
    }
  }
  return false;
}

function rulesMayContainExactMixinSurface(rules: Rules): boolean {
  if (rules.mayContainExactMixinSurface !== undefined) {
    return rules.mayContainExactMixinSurface;
  }
  const value = rules.rules;
  for (let i = 0; i < value.length; i++) {
    const node = value[i]!;
    if (((node.nodeType ?? 0) & N.Mixin) !== 0) {
      rules.mayContainExactMixinSurface = true;
      return true;
    }
    const child = childCallableRulesOf(node);
    if (child && rulesMayContainExactMixinSurface(child)) {
      rules.mayContainExactMixinSurface = true;
      return true;
    }
  }
  rules.mayContainExactMixinSurface = false;
  return false;
}

function rulesMayContainExactRulesetSurface(rules: Rules): boolean {
  if (rules.mayContainExactRulesetSurface !== undefined) {
    return rules.mayContainExactRulesetSurface;
  }
  const value = rules.rules;
  for (let i = 0; i < value.length; i++) {
    const node = value[i]!;
    if (((node.nodeType ?? 0) & N.Ruleset) !== 0) {
      rules.mayContainExactRulesetSurface = true;
      return true;
    }
    const child = childCallableRulesOf(node);
    if (child && rulesMayContainExactRulesetSurface(child)) {
      rules.mayContainExactRulesetSurface = true;
      return true;
    }
  }
  rules.mayContainExactRulesetSurface = false;
  return false;
}

function rulesMayContainDeclarationSurface(rules: Rules): boolean {
  const value = rules.rules;
  for (let i = 0; i < value.length; i++) {
    const node = value[i]!;
    const nodeType = node.nodeType ?? 0;
    if ((nodeType & N.Declaration) !== 0 && (nodeType & N.VarDeclaration) === 0 && !node.options?.setDefined) {
      return true;
    }
    const child = childRulesOf(node);
    if (child && rulesMayContainDeclarationSurface(child)) {
      return true;
    }
  }
  return false;
}

function isMergeDeclarationSurfaceNode(node: Node): boolean {
  const nodeType = node.nodeType ?? 0;
  if ((nodeType & N.Declaration) === 0 || (nodeType & N.VarDeclaration) !== 0 || node.options?.setDefined) {
    return false;
  }
  const assign = node.options?.normalizedFromAssign;
  return assign === '&,:' || assign === '&_:';
}

function rulesMayContainMergeDeclarationSurface(rules: Rules): boolean {
  const value = rules.rules;
  for (let i = 0; i < value.length; i++) {
    const node = value[i]!;
    if (isMergeDeclarationSurfaceNode(node)) {
      return true;
    }
    const child = childRulesOf(node);
    if (child && rulesMayContainMergeDeclarationSurface(child)) {
      return true;
    }
  }
  return false;
}

function rulesMayContainVarDeclarationSurface(rules: Rules): boolean {
  const value = rules.rules;
  for (let i = 0; i < value.length; i++) {
    const node = value[i]!;
    if (((node.nodeType ?? 0) & N.VarDeclaration) !== 0 && !node.options?.setDefined) {
      return true;
    }
    const child = childRulesOf(node);
    if (child && rulesMayContainVarDeclarationSurface(child)) {
      return true;
    }
  }
  return false;
}

function rulesMayContainExtends(rules: Rules): boolean {
  if (rules._hasExtends) {
    return true;
  }
  const value = rules.rules;
  for (let i = 0; i < value.length; i++) {
    const node = value[i]!;
    if (node.type === 'Extend' || node.type === 'ExtendList') {
      return true;
    }
    const child = childRulesOf(node);
    if (child && rulesMayContainExtends(child)) {
      return true;
    }
  }
  return false;
}

function rulesMayContainReferenceImports(rules: Rules): boolean {
  if (
    (rules.options as { referenceMode?: boolean } | undefined)?.referenceMode === true
    || rules._hasReferenceImports
    || rules.hasReferenceImportChildSurface
  ) {
    return true;
  }
  if (rules.mayContainReferenceImportSurface !== undefined) {
    return rules.mayContainReferenceImportSurface;
  }
  const value = rules.rules;
  for (let i = 0; i < value.length; i++) {
    const node = value[i]!;
    if (node.type === 'StyleImport') {
      const importOptions = 'importOptions' in node.options
        ? node.options.importOptions
        : undefined;
      if (importOptions?.reference === true || importOptions?._dedupe === true) {
        return true;
      }
      continue;
    }
    const child = childRulesOf(node);
    if (child && rulesMayContainReferenceImports(child)) {
      return true;
    }
  }
  rules.mayContainReferenceImportSurface = false;
  return false;
}

function rulesHasCarriedReferenceImportSurface(rules: Rules): boolean {
  return (
    (rules.options as { referenceMode?: boolean } | undefined)?.referenceMode === true
    || rules._hasReferenceImports
    || rules.hasReferenceImportChildSurface
  );
}

function sourceRulesOf(rules: Rules): Rules {
  return isNode(rules.sourceNode, N.Rules) ? rules.sourceNode : rules;
}

function isStyleImportPathResolutionError(error: unknown): boolean {
  return error instanceof Error && (error as PathResolutionError)._isPathResolutionError === true;
}

function hasFlagMethod(value: unknown): value is FlagLikeNode {
  return typeof value === 'object'
    && value !== null
    && 'hasFlag' in value
    && typeof value.hasFlag === 'function';
}

function consumeLeadingTrivia(node: Node, options: PrintOptions): string {
  const trivia = (options.trivia ?? node.sourceRoot?._treeContext?.opts?.trivia) as
    | TreeContext['opts']['trivia']
    | undefined;
  if (trivia && options.trivia !== trivia) {
    options.trivia = trivia;
  }
  const offset = node.location[0];
  return trivia ? consumeTriviaText(trivia, offset, 'before', options) : '';
}

function consumeEofTrivia(node: Node, options: PrintOptions): string {
  const trivia = (options.trivia ?? node.sourceRoot?._treeContext?.opts?.trivia) as
    | TreeContext['opts']['trivia']
    | undefined;
  if (trivia && options.trivia !== trivia) {
    options.trivia = trivia;
  }
  return trivia ? consumeTriviaText(trivia, Infinity, 'before', options) : '';
}

function writeDetached(options: PrintOptions, fn: (nextOptions: FinalPrintOptions) => void): string {
  const writer = new OutputWriter();
  fn(getPrintOptions({
    ...options,
    writer
  }));
  return writer.toString();
}

export type RulesVisibility = 'public' | 'optional' | 'private';
type CallableRulesetPrefixMatch = { ruleset: Ruleset; consumed: string[]; scope: Rules };

export type RulesOptions = {
  /**
   * - public   = all members are considered in lookup algorithms
   * - optional = members are only considered if not found in the lookup tree
   * - private  = can't be looked up
   * - local    = only visible in the current scope
   *
   * Different types may have different defaults
   *
   * For Less:
   *   - When mixins are parsed, their rules body is set to:
   *     visibility: {
   *       Ruleset: 'public',
   *       Declaration: 'public',
   *       VarDeclaration: 'optional',
   *       Mixin: 'public'
   *     }
   *  - When detached rulesets are parsed, their rules body is set to:
   *    visibility: {
   *      Ruleset: 'public',
   *      Declaration: 'public',
   *      VarDeclaration: 'private', <-- the one notable difference
   *      Mixin: 'public'
   *    }
   * @note - The reason Less has "optionality" is likely because it tries
   * to eagerly resolve variables, so even though its in a
   * child scope, it will still be considered if nothing else in the
   * scope is found. I'm guessing this is because "overwriting" a local
   * variable from something like a mixin call would be counter-intuitive,
   * but at the same time, I guess Alexis thought that eagerly resolving
   * the variable might be useful.
   *
   * Note that right now, only Declarations being set to "optional"
   * are supported. Everything else must be public or private.
   *
   * For Imports, the rules body is set to:
   *     visibility: {
   *       Ruleset: 'public',
   *       Declaration: 'public',
   *       VarDeclaration: 'public',
   *       Mixin: 'public'
   *    }
   */
  rulesVisibility?: Record<string, RulesVisibility>;
  /** Current compatibility carrier for explicit generated mixin-output state. */
  mixinOutputSlot?: MixinOutputSlot;
  /** True for callable wrappers whose children are canonical source nodes. */
  sourceBackedCallableSurface?: boolean;
  /** True for import placement wrappers whose children stay source-owned. */
  sourceBackedImportPlacement?: boolean;
  /**
   * Marks declaration-only Rules emitted from non-mixin call sites so post-eval
   * ordering can move them ahead of nested rulesets/at-rules without relying on
   * a live call-site back-pointer on the emitted Rules wrapper.
   */
  callDeclarationOutput?: boolean;
  /**
   * Marks shallow output wrappers produced by control nodes such as `$for` and
   * `$while`. These wrappers can be returned as already-evaluated call output,
   * so render must still run post-eval declaration merge coalescing once.
   */
  generatedControlOutput?: boolean;
  readonly?: boolean;
  /**
   * all imports other than classic `@import` set returned rules to local.
   * The reason is that variables are not transitive, and you need to re-use
   * modules to get the same variables.
   */
  local?: boolean;
  /**
   * Sass `@forward` semantics: this Rules node exists as an export surface for downstream
   * consumers, but should not be visible to lookups within the current stylesheet scope.
   */
  forward?: boolean;
  /** Non-classic import boundary marker (`compose`, `use`, `forward`, etc.). */
  importBoundary?: boolean;
  /** Render gating marker for referenced imports/usages (serializer-time only). */
  referenceMode?: boolean;
};

export interface Rules extends Node<Node[], RulesOptions & NodeOptions> {
  get options(): RulesOptions & NodeOptions & {
    rulesVisibility: Record<string, RulesVisibility>;
  };
  set options(options: RulesOptions & NodeOptions & {
    rulesVisibility: Record<string, RulesVisibility>;
  });
  eval(context: Context): MaybePromise<this>;
}

const DEFAULT_DIRECT_CHILD_RULES_VISIBILITY: RulesOptions['rulesVisibility'] = {
  Declaration: 'public',
  Ruleset: 'public',
  Mixin: 'public'
};

function hasRulesVisibilityOverrides(rulesVisibility: RulesOptions['rulesVisibility'] | undefined): boolean {
  return (
    rulesVisibility !== undefined
    && (
      rulesVisibility.Declaration !== undefined
      || rulesVisibility.Ruleset !== undefined
      || rulesVisibility.Mixin !== undefined
      || rulesVisibility.VarDeclaration !== undefined
    )
  );
}

function mergeDirectChildRulesVisibility(
  childVisibility: RulesOptions['rulesVisibility'] | undefined,
  rulesVisibility: RulesOptions['rulesVisibility'] | undefined
): RulesOptions['rulesVisibility'] {
  if (!hasRulesVisibilityOverrides(childVisibility) && !hasRulesVisibilityOverrides(rulesVisibility)) {
    return DEFAULT_DIRECT_CHILD_RULES_VISIBILITY;
  }
  const merged: RulesOptions['rulesVisibility'] = {
    ...childVisibility,
    ...rulesVisibility
  };
  merged.Declaration ??= 'public';
  merged.Ruleset ??= 'public';
  merged.Mixin ??= 'public';
  return merged;
}

function collectCallableBucketResults(
  bucket: CallableLookupEntry[],
  includeRulesets: boolean
): MixinEntry[] | undefined {
  return appendCallableBucketResults(bucket, includeRulesets);
}

function appendCallableBucketResults(
  bucket: CallableLookupEntry[],
  includeRulesets: boolean,
  results?: MixinEntry[]
): MixinEntry[] | undefined {
  for (let i = bucket.length - 1; i >= 0; i--) {
    const entry = bucket[i]!;
    if (entry.match.length !== 0) {
      continue;
    }
    const candidate = entry.value;
    if (!includeRulesets && isNode(candidate, N.Ruleset)) {
      continue;
    }
    (results ??= []).push(candidate);
  }
  return results;
}

function collectCallableBucketRemainderResults(
  bucket: CallableLookupEntry[],
  includeRulesets: boolean,
  path: readonly string[],
  offset: number
): MixinEntry[] | undefined {
  const restLength = path.length - offset - 1;
  if (restLength <= 0) {
    return undefined;
  }
  let results: MixinEntry[] | undefined;
  for (let i = bucket.length - 1; i >= 0; i--) {
    const entry = bucket[i]!;
    if (entry.match.length !== restLength) {
      continue;
    }
    let matchesRemainder = true;
    for (let matchIndex = 0; matchIndex < entry.match.length; matchIndex++) {
      if (entry.match[matchIndex] !== path[offset + 1 + matchIndex]) {
        matchesRemainder = false;
        break;
      }
    }
    if (!matchesRemainder) {
      continue;
    }
    const candidate = entry.value;
    if (!includeRulesets && isNode(candidate, N.Ruleset)) {
      continue;
    }
    (results ??= []).push(candidate);
  }
  return results;
}

function appendCallableNamespaceGuard(
  existing: CallableNamespaceGuard[] | undefined,
  guard: Node,
  rules: Rules
): CallableNamespaceGuard[] {
  if (existing?.length) {
    for (let i = 0; i < existing.length; i++) {
      const current = existing[i]!;
      if (current.guard === guard && current.rules === rules) {
        return existing;
      }
    }
  }
  if (!existing?.length) {
    return [{ guard, rules }];
  }
  const next = existing.slice();
  next.push({ guard, rules });
  return next;
}

function withRulesetNamespaceGuard(entry: MixinEntry, ruleset: Ruleset): MixinEntry {
  const guard = ruleset.guard;
  if (!guard || guard instanceof Nil || !isCallableEntry(entry)) {
    return entry;
  }
  const callableEntry = entry as CallableEntry;
  return callableRulesEntry({
    name: getCallableEntryName(callableEntry),
    params: getCallableEntryParams(callableEntry),
    rules: getMixinEntryRules(callableEntry),
    guard: getCallableEntryGuard(callableEntry)
  }, isNode(entry, N.Mixin) ? entry.sourceParent : entry.parent, entry.index, appendCallableNamespaceGuard(
    getCallableEntryNamespaceGuards(callableEntry),
    guard,
    ruleset.rules
  ));
}

function withCallableNamespaceGuard(entry: MixinEntry, namespace: CallableEntry): MixinEntry {
  if (!isCallableEntry(entry)) {
    return entry;
  }
  const namespaceGuard = getCallableEntryGuard(namespace);
  const inheritedGuards = getCallableEntryNamespaceGuards(namespace);
  if (!namespaceGuard && !inheritedGuards?.length) {
    return entry;
  }
  const callableEntry = entry as CallableEntry;
  let namespaceGuards = getCallableEntryNamespaceGuards(callableEntry);
  if (inheritedGuards?.length) {
    for (let i = 0; i < inheritedGuards.length; i++) {
      const inherited = inheritedGuards[i]!;
      namespaceGuards = appendCallableNamespaceGuard(namespaceGuards, inherited.guard, inherited.rules);
    }
  }
  if (namespaceGuard) {
    namespaceGuards = appendCallableNamespaceGuard(namespaceGuards, namespaceGuard, getMixinEntryRules(namespace));
  }
  return callableRulesEntry({
    name: getCallableEntryName(callableEntry),
    params: getCallableEntryParams(callableEntry),
    rules: getMixinEntryRules(callableEntry),
    guard: getCallableEntryGuard(callableEntry)
  }, isNode(entry, N.Mixin) ? entry.sourceParent : entry.parent, entry.index, namespaceGuards);
}

function withRulesetNamespaceGuards(entries: MixinEntry[], ruleset: Ruleset): MixinEntry[] {
  if (ruleset.guard instanceof Nil) {
    return entries;
  }
  const guarded: MixinEntry[] = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    guarded[i] = withRulesetNamespaceGuard(entries[i]!, ruleset);
  }
  return guarded;
}

function withCallableNamespaceGuards(entries: MixinEntry[], namespace: CallableEntry): MixinEntry[] {
  if (!getCallableEntryGuard(namespace) && !getCallableEntryNamespaceGuards(namespace)?.length) {
    return entries;
  }
  const guarded: MixinEntry[] = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    guarded[i] = withCallableNamespaceGuard(entries[i]!, namespace);
  }
  return guarded;
}

function staticCallableAncestorKey(node: Node): string | undefined {
  if (isNode(node, N.Mixin)) {
    const name = getCallableEntryName(node);
    return name instanceof Node ? String(name.valueOf()) : String(name ?? '');
  }
  if (isNode(node, N.Ruleset) && !isNode(node.selector, N.Nil)) {
    const keys = getOrderedSelectorKeys(node.selector);
    return keys.length === 1 ? keys[0] : undefined;
  }
  return undefined;
}

function withSourceNamespaceGuards(entry: MixinEntry, path: readonly string[]): MixinEntry {
  if (!isCallableEntry(entry) || path.length < 2) {
    return entry;
  }
  const namespacePath = path.slice(0, -1);
  let namespaceGuards = getCallableEntryNamespaceGuards(entry);
  let namespaceIndex = namespacePath.length - 1;
  let cursor: Node | undefined = isNode(entry)
    ? entry.sourceParent
    : entry.parent;
  while (cursor) {
    if (isNode(cursor, N.Mixin)) {
      const key = staticCallableAncestorKey(cursor);
      if (key && namespaceIndex >= 0 && key === namespacePath[namespaceIndex]) {
        const guard = getCallableEntryGuard(cursor);
        if (guard) {
          namespaceGuards = appendCallableNamespaceGuard(namespaceGuards, guard, cursor.rules);
        }
        namespaceIndex--;
      }
    } else if (isNode(cursor, N.Ruleset)) {
      const key = staticCallableAncestorKey(cursor);
      if (key && namespaceIndex >= 0 && key === namespacePath[namespaceIndex]) {
        if (cursor.guard && !(cursor.guard instanceof Nil)) {
          namespaceGuards = appendCallableNamespaceGuard(namespaceGuards, cursor.guard, cursor.rules);
        }
        namespaceIndex--;
      }
    }
    cursor = cursor.sourceParent;
  }
  if (!namespaceGuards?.length) {
    return entry;
  }
  const callableEntry = entry as CallableEntry;
  return callableRulesEntry({
    name: getCallableEntryName(callableEntry),
    params: getCallableEntryParams(callableEntry),
    rules: getMixinEntryRules(callableEntry),
    guard: getCallableEntryGuard(callableEntry)
  }, isNode(entry) ? entry.sourceParent : entry.parent, entry.index, namespaceGuards);
}

function entryMatchesNamespaceSourcePath(entry: MixinEntry, path: readonly string[]): boolean {
  if (path.length < 2) {
    return true;
  }
  if (isNode(entry, N.Ruleset)) {
    const terminalKey = path[path.length - 1];
    const keyPaths = getCallableRulesetKeyPaths(entry);
    for (let i = 0; i < keyPaths.length; i++) {
      const keys = keyPaths[i]!;
      if (keysEndWithPath(keys, path)) {
        return true;
      }
      if (terminalKey !== undefined && keys[keys.length - 1] === terminalKey) {
        return true;
      }
    }
    const selectorKeys = collectStaticSelectorCallableKeys(String(entry.selector.valueOf()));
    if (selectorKeys.length > 0 && keysEndWithPath(selectorKeys, path)) {
      return true;
    }
    if (terminalKey !== undefined && selectorKeys[selectorKeys.length - 1] === terminalKey) {
      return true;
    }
  }
  let namespaceIndex = path.length - 2;
  let cursor: Node | undefined = isNode(entry)
    ? entry.sourceParent
    : entry.parent;
  while (cursor && namespaceIndex >= 0) {
    const key = staticCallableAncestorKey(cursor);
    if (key) {
      if (key !== path[namespaceIndex]) {
        return false;
      }
      namespaceIndex--;
    }
    cursor = cursor.sourceParent;
  }
  return namespaceIndex < 0;
}

function keysEndWithPath(keys: readonly string[], path: readonly string[]): boolean {
  if (keys.length < path.length) {
    return false;
  }
  const start = keys.length - path.length;
  for (let pathIndex = 0; pathIndex < path.length; pathIndex++) {
    if (keys[start + pathIndex] !== path[pathIndex]) {
      return false;
    }
  }
  return true;
}

function collectStaticSelectorCallableKeys(selector: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < selector.length; i++) {
    const marker = selector.charCodeAt(i);
    if (marker !== 35 && marker !== 46) {
      continue;
    }
    const start = i;
    i++;
    while (i < selector.length) {
      const char = selector.charCodeAt(i);
      if (
        char <= 32
        || char === 35
        || char === 40
        || char === 41
        || char === 43
        || char === 44
        || char === 46
        || char === 58
        || char === 62
        || char === 91
        || char === 93
        || char === 123
        || char === 126
        || char === 125
      ) {
        break;
      }
      i++;
    }
    if (i > start + 1) {
      keys.push(selector.slice(start, i));
    }
    i--;
  }
  return keys;
}

function withSourceNamespaceGuardsForPath(entries: MixinEntry[], path: readonly string[]): MixinEntry[] {
  let guarded: MixinEntry[] | undefined;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const next = withSourceNamespaceGuards(entry, path);
    if (next === entry && guarded === undefined) {
      continue;
    }
    if (guarded === undefined) {
      guarded = entries.slice(0, i);
    }
    guarded.push(next);
  }
  return guarded ?? entries;
}

function compareMixinEntrySourceOrder(a: MixinEntry, b: MixinEntry): number {
  if (a === b) {
    return 0;
  }
  const aNode = isNode(a) ? a : a.parent;
  const bNode = isNode(b) ? b : b.parent;
  if (aNode && bNode) {
    try {
      const compared = comparePosition(aNode, bNode);
      if (compared !== 0) {
        return compared;
      }
    } catch {
      // Fall through to local index ordering for detached callable wrappers.
    }
  }
  return (a.index ?? 0) - (b.index ?? 0);
}

function sameNamespaceGuardChain(a: CallableNamespaceGuard[] | undefined, b: CallableNamespaceGuard[] | undefined): boolean {
  const aLength = a?.length ?? 0;
  const bLength = b?.length ?? 0;
  if (aLength !== bLength) {
    return false;
  }
  for (let i = 0; i < aLength; i++) {
    if (a![i]!.guard !== b![i]!.guard || a![i]!.rules !== b![i]!.rules) {
      return false;
    }
  }
  return true;
}

function dedupeNamespaceCallableResults(entries: MixinEntry[]): MixinEntry[] {
  let deduped: MixinEntry[] | undefined;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    let duplicate = false;
    const current = deduped ?? entries;
    const limit = deduped === undefined ? i : current.length;
    for (let j = 0; j < limit; j++) {
      const seen = current[j]!;
      if (
        getMixinEntryRules(seen) === getMixinEntryRules(entry)
        && sameNamespaceGuardChain(
          isCallableEntry(seen) ? getCallableEntryNamespaceGuards(seen) : undefined,
          isCallableEntry(entry) ? getCallableEntryNamespaceGuards(entry) : undefined
        )
      ) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) {
      if (deduped !== undefined) {
        deduped.push(entry);
      }
      continue;
    }
    if (deduped === undefined) {
      deduped = entries.slice(0, i);
    }
  }
  return deduped ?? entries;
}

function normalizeNamespaceCallableResults(entries: MixinEntry[], path: readonly string[]): MixinEntry[] {
  if (entries.length === 0) {
    return entries;
  }
  const guarded = dedupeNamespaceCallableResults(withSourceNamespaceGuardsForPath(entries, path));
  if (guarded.length < 2) {
    return guarded;
  }
  const ordered = guarded.slice();
  ordered.sort(compareMixinEntrySourceOrder);
  return ordered;
}

function normalizeCompoundPrefixCallableResults(entries: MixinEntry[]): MixinEntry[] {
  return dedupeNamespaceCallableResults(entries);
}

type AssignmentTargetBindingTarget = {
  assignmentBindingsByName?: Map<string, BindingCell>;
  assignmentReadonlyByName?: Set<string>;
};

function addAssignmentTargetBinding(
  target: AssignmentTargetBindingTarget,
  name: string,
  cell: BindingCell,
  readonlyOverlay: boolean,
  shadowingFrame?: ScopeFrame
): void {
  if (shadowingFrame?.currentBindingsByName.has(name)) {
    return;
  }
  const bindings = target.assignmentBindingsByName ?? (target.assignmentBindingsByName = new Map());
  if (bindings.has(name)) {
    return;
  }
  bindings.set(name, cell);
  if (readonlyOverlay && !cell.readonly) {
    (target.assignmentReadonlyByName ??= new Set()).add(name);
  }
}

function setAssignmentTargetBinding(
  target: AssignmentTargetBindingTarget,
  name: string,
  cell: BindingCell,
  readonlyOverlay: boolean
): void {
  const bindings = target.assignmentBindingsByName ?? (target.assignmentBindingsByName = new Map());
  bindings.set(name, cell);
  if (readonlyOverlay && !cell.readonly) {
    (target.assignmentReadonlyByName ??= new Set()).add(name);
  } else {
    target.assignmentReadonlyByName?.delete(name);
  }
}

/**
 * The class representing a "declaration list".
 * CSS calls it this even though CSS Nesting
 * adds a bunch more things that aren't declarations.
 *
 * Used by Ruleset and Mixin. Additionally, imports / use statements
 * return rules.
 *
 * @example
 * [
 *   (Declaration color: black;)
 *   (Declaration background-color: white;)
 * ]
 */
export class Rules extends Node<Node[], RulesOptions & NodeOptions> {
  static override childKeys = ['rules'] as const;

  readonly rules: Node[];

  override allowRuleRoot = true;
  override allowRoot = true;

  functionsByName: Map<string, JsFunction | Func> | undefined;
  /** Fast map: var name -> ordered static VarDeclaration binding entries in this scope. */
  varsByName: Map<string, BindingEntry[]> | undefined;
  /** Per-request cache: callable start-key -> ordered entries with remaining path keys. */
  callableLookupCache: Map<string, CallableLookupEntry[] | null> | undefined;
  directChildRuleEntries: Array<RulesEntryLike> | null | undefined;
  directDeclarationChildEntries: Array<RulesEntryLike> | null | undefined;
  hasDirectChildRuleSurface = false;
  hasDeclarationChildSurface = false;
  hasVarDeclarationChildSurface = false;
  hasMergeDeclarationChildSurface = false;
  hasReferenceImportChildSurface = false;
  hasExactCallableChildSurface = false;
  hasExactMixinChildSurface = false;
  hasExactRulesetChildSurface = false;
  mayContainExactMixinSurface: boolean | undefined;
  mayContainExactRulesetSurface: boolean | undefined;
  mayContainReferenceImportSurface: boolean | undefined;
  directDeclarationsByName: Map<string, Declaration[] | null> | undefined;
  directDeclarationLookupCache: Map<string, {
    readonly optionalMatch: DirectDeclarationOccurrence | undefined;
    readonly publicMatch: DirectDeclarationOccurrence | undefined;
    readonly readonly: boolean;
  }> | undefined;

  lookupVersion = 0;
  declarationLookupVersion = 0;
  declarationLookupVersionsByName: Map<string, number> | undefined;
  callableLookupVersion = 0;
  functionLookupVersion = 0;
  functionLookupVersionsByName: Map<string, number> | undefined;
  /** ScopeFrame storage; check this when lookup must not lazily build a frame. */
  _scopeFrame: ScopeFrame | undefined;
  /**
   * Track whether this Rules subtree contains extend instructions.
   * Prep work for Track 5 segmented render selection.
   */
  _hasExtends = false;
  /**
   * Track whether this Rules subtree contains any reference-import render
   * surfaces (`referenceMode` wrappers or reference/dedupe style imports).
   * Used to skip serializer-time reference-origin work when impossible.
   */
  _hasReferenceImports = false;

  private _registrationPrepared = false;
  private _generatedControlOutputCoalesced = false;

  /**
   * Rules clones still need to preserve function bindings so visitor/plugin
   * registrations survive the explicit clone sites that remain outside the hot path.
   */
  override clone(copyChildren?: boolean, cloneFn?: (n: Node) => Node): this {
    const newRules = super.clone(copyChildren, cloneFn);
    newRules.resetDerivedState(this);

    return newRules;
  }

  derive(value: Node[] = [...this.rules]): Rules {
    const sourceLocation = this.location.length === 6 ? this.location : undefined;
    const derived = Reflect.construct(
      this.constructor,
      [
        value,
        this.options ? { ...this.options } : undefined,
        sourceLocation,
        this.sourceRoot?._treeContext
      ]
    );
    if (!(derived instanceof Rules)) {
      throw new TypeError('Derived rules value must remain rules-like');
    }
    derived.inherit(this);
    derived.resetDerivedState(this);

    return derived;
  }

  private resetDerivedState(source: Rules): void {
    // Only preserve explicit function bindings across clones. This supports
    // Less plugin compat without reusing derived declaration/callable lookup
    // state, which must be rebuilt from AST nodes via lazy indexing.
    if (source.functionsByName) {
      this.functionsByName = new Map(source.functionsByName);
      this.functionLookupVersion = source.functionLookupVersion;
      this.functionLookupVersionsByName = source.functionLookupVersionsByName
        ? new Map(source.functionLookupVersionsByName)
        : undefined;
    } else {
      this.functionsByName = undefined;
      this.functionLookupVersion = 0;
      this.functionLookupVersionsByName = undefined;
    }

    // IMPORTANT: cloned Rules must rebuild their derived lookup state.
    // Otherwise, a clone can inherit empty/incorrect lookup maps, causing
    // lookup misses (e.g. @c in detached-rulesets).
    this.varsByName = undefined;
    this.callableLookupCache = undefined;
    this.directChildRuleEntries = undefined;
    this.directDeclarationChildEntries = undefined;
    this.hasDirectChildRuleSurface = false;
    this.hasDeclarationChildSurface = false;
    this.hasVarDeclarationChildSurface = false;
    this.hasMergeDeclarationChildSurface = false;
    this.hasReferenceImportChildSurface = false;
    this.hasExactCallableChildSurface = false;
    this.hasExactMixinChildSurface = false;
    this.hasExactRulesetChildSurface = false;
    this.mayContainExactMixinSurface = undefined;
    this.mayContainExactRulesetSurface = undefined;
    this.mayContainReferenceImportSurface = undefined;
    this.directDeclarationsByName = undefined;
    this.directDeclarationLookupCache = undefined;
    this.lookupVersion = 0;
    this.declarationLookupVersion = 0;
    this.declarationLookupVersionsByName = undefined;
    this.callableLookupVersion = 0;
    this._hasExtends = false;
    this._hasReferenceImports = false;
    // Preserve explicit runtime frame placement across shallow Rules surfaces.
    // Ordinary declaration-only ScopeFrames should still be rebuilt lazily when
    // they have no live/parent/fallback placement state.
    if (source._scopeFrame?.hasLiveBindings || source._scopeFrame?.parent || source._scopeFrame?.fallbackFrame) {
      this.scopeFrame = buildScopeFrame(
        undefined,
        this,
        source._scopeFrame.parent,
        copyScopeFrameLiveBindingSlots(source._scopeFrame),
        undefined,
        false,
        undefined,
        false
      );
      this._scopeFrame!.fallbackFrame = source._scopeFrame.fallbackFrame;
    } else {
      this.scopeFrame = undefined;
    }
  }

  /**
   * Lazily build and cache the ScopeFrame for this scope.
   * Prepares declaration cells directly when no evaluated binding state exists.
   *
   * Parent frame: if the caller supplies one it is used directly (mixin
   * call sites do this to wire the call-site lexical chain). Otherwise the
   * nearest ancestor Rules node builds/returns its scopeFrame, so inner rules
   * nodes inherit the represented parent frame even when the ancestor frame
   * was not accessed first.
   */
  get scopeFrame(): ScopeFrame {
    return this.getScopeFrame();
  }

  set scopeFrame(frame: ScopeFrame | undefined) {
    this._scopeFrame = frame;
  }

  getScopeFrame(parent?: ScopeFrame, prepareCallableCoverage = true): ScopeFrame {
    if (!this._scopeFrame) {
      let pendingDeclarationNames: VarDeclaration[] | undefined;
      if (this.varsByName === undefined) {
        pendingDeclarationNames = this.prepareScopeFrameDeclarationIndex();
      }
      let resolvedParent = parent;
      if (resolvedParent === undefined) {
        let cursor = this.sourceParent;
        while (cursor) {
          if (isNode(cursor, N.Rules)) {
            resolvedParent = (cursor as Rules).getScopeFrame(undefined, prepareCallableCoverage);
            break;
          }
          cursor = cursor.sourceParent;
        }
      }
      this._scopeFrame = buildScopeFrame(
        this.varsByName,
        this,
        resolvedParent,
        undefined,
        pendingDeclarationNames ?? this.collectScopeFramePendingDeclarationNames(),
        undefined,
        this.callableLookupCache,
        undefined,
        prepareCallableCoverage ? !this.hasDirectLookupChildSurface() : false,
        prepareCallableCoverage ? !this.hasDirectLookupChildSurface(false) : false,
        prepareCallableCoverage,
        prepareCallableCoverage,
        this._hasReferenceImports
      );
      this.prepareScopeFrameAssignmentBindings(this._scopeFrame);
    }
    return this._scopeFrame;
  }

  private collectScopeFramePendingDeclarationNames(): VarDeclaration[] | undefined {
    let pendingDeclarationNames: VarDeclaration[] | undefined;
    const value = this.rules;
    for (let i = 0; i < value.length; i++) {
      const node = value[i]!;
      if (isNode(node, N.VarDeclaration) && !this._hasStaticName(node)) {
        (pendingDeclarationNames ??= []).push(node);
      }
    }
    return pendingDeclarationNames;
  }

  private prepareScopeFrameDeclarationIndex(): VarDeclaration[] | undefined {
    const varsByName = this.varsByName = new Map();
    const value = this.rules;
    let pendingDeclarationNames: VarDeclaration[] | undefined;
    this._hasReferenceImports = (
      this._hasReferenceImports
      || this.hasReferenceImportChildSurface
      || (this.options as { referenceMode?: boolean } | undefined)?.referenceMode === true
    );
    for (let i = 0; i < value.length; i++) {
      const node = value[i]!;
      if (node.type === 'StyleImport') {
        const importOptions = 'importOptions' in node.options
          ? node.options.importOptions
          : undefined;
        if (importOptions?.reference === true || importOptions?._dedupe === true) {
          this._hasReferenceImports = true;
        }
        continue;
      }
      if (isNode(node, N.Rules)) {
        if (
          rulesHasCarriedReferenceImportSurface(node)
          || (!node._registrationPrepared && rulesMayContainReferenceImports(node))
        ) {
          this._hasReferenceImports = true;
        }
        continue;
      }
      if (!isNode(node, N.VarDeclaration)) {
        continue;
      }
      if (node.options?.setDefined) {
        continue;
      }
      if (!this._hasStaticName(node)) {
        (pendingDeclarationNames ??= []).push(node);
        continue;
      }
      const name = node.name.valueOf();
      let bucket = varsByName.get(name);
      if (!bucket) {
        varsByName.set(name, bucket = []);
      }
      bucket.push(createVarDeclarationBindingEntry(node, this));
    }
    return pendingDeclarationNames;
  }

  prepareScopeFrameDeclarationBindings(): {
    varsByName: Map<string, BindingEntry[]>;
    pendingDeclarationNames: VarDeclaration[] | undefined;
  } {
    const pendingDeclarationNames = this.varsByName === undefined
      ? this.prepareScopeFrameDeclarationIndex()
      : this.collectScopeFramePendingDeclarationNames();
    return {
      varsByName: this.varsByName ?? new Map(),
      pendingDeclarationNames
    };
  }

  private prepareScopeFrameAssignmentBindings(frame: ScopeFrame): void {
    this.collectPublicChildVariableAssignmentBindingsInto(false, frame, frame);
    frame.hasUncoveredAssignmentTargetSurface = this.hasUncoveredChildVariableAssignmentSurface();
  }

  private getHasUncoveredAssignmentTargetEntrySurface(): boolean {
    return this.hasUncoveredVariableAssignmentSurface();
  }

  private collectPublicVariableAssignmentBindingsInto(
    inheritedReadonly: boolean,
    target: RulesEntryLike
  ): void {
    const localReadonly = inheritedReadonly || Boolean(this.options.readonly);
    if (this.options.rulesVisibility?.VarDeclaration === 'public') {
      if (this.varsByName === undefined) {
        this.prepareScopeFrameDeclarationIndex();
      }
      if (this.varsByName) {
        for (const [name, entries] of this.varsByName) {
          for (let i = 0; i < entries.length; i++) {
            const entry = entries[i]!;
            setAssignmentTargetBinding(target, name, entry.cell, localReadonly && !entry.cell.readonly);
          }
        }
      }
    }

    this.collectPublicChildVariableAssignmentBindingsInto(localReadonly, target);
  }

  private collectPublicChildVariableAssignmentBindingsInto(
    inheritedReadonly: boolean,
    target: AssignmentTargetBindingTarget,
    shadowingFrame?: ScopeFrame
  ): void {
    const childEntries = this.collectDirectDeclarationChildEntries();
    if (!childEntries?.length) {
      return;
    }
    for (let i = childEntries.length - 1; i >= 0; i--) {
      const entry = childEntries[i]!;
      if (
        entry.hasVarDeclarationSurface === false
        && entry.hasReferenceImportSurface !== true
      ) {
        continue;
      }
      if (!canEnterRulesEntryForLookup(entry, { type: 'VarDeclaration' })) {
        continue;
      }
      if (!canEnterMixinOutputForLookup(entry, { type: 'VarDeclaration' })) {
        continue;
      }
      if (!isPublicRulesEntry(entry, 'VarDeclaration')) {
        continue;
      }
      const entryBindings = entry.assignmentBindingsByName;
      if (!entryBindings?.size) {
        continue;
      }
      for (const [name, cell] of entryBindings) {
        addAssignmentTargetBinding(
          target,
          name,
          cell,
          inheritedReadonly || Boolean(entry.assignmentReadonlyByName?.has(name)),
          shadowingFrame
        );
      }
    }
  }

  private hasUncoveredVariableAssignmentSurface(): boolean {
    if (this.options.rulesVisibility?.VarDeclaration === 'public') {
      const value = this.rules;
      for (let i = 0; i < value.length; i++) {
        const node = value[i]!;
        if (
          isNode(node, N.VarDeclaration)
          && !node.options?.setDefined
          && !this._hasStaticName(node)
        ) {
          return true;
        }
      }
    }
    return this.hasUncoveredChildVariableAssignmentSurface();
  }

  private hasUncoveredChildVariableAssignmentSurface(): boolean {
    const childEntries = this.collectDirectDeclarationChildEntries();
    if (!childEntries?.length) {
      return false;
    }
    for (let i = childEntries.length - 1; i >= 0; i--) {
      const entry = childEntries[i]!;
      if (
        entry.hasVarDeclarationSurface === false
        && entry.hasReferenceImportSurface !== true
      ) {
        continue;
      }
      if (!canEnterRulesEntryForLookup(entry, { type: 'VarDeclaration' })) {
        continue;
      }
      if (!canEnterMixinOutputForLookup(entry, { type: 'VarDeclaration' })) {
        continue;
      }
      if (isOptionalRulesEntry(entry, 'VarDeclaration')) {
        return true;
      }
      if (entry.hasUncoveredAssignmentTargetSurface) {
        return true;
      }
    }
    return false;
  }

  private hasReferenceImportLookupSurface(): boolean {
    return (
      this.hasReferenceImportChildSurface
      || (
        this._hasReferenceImports
        && (this.options as { referenceMode?: boolean } | undefined)?.referenceMode !== true
      )
    );
  }

  private hasDirectLookupChildSurface(includeRulesets = true): boolean {
    if (this.hasReferenceImportLookupSurface()) {
      return true;
    }
    if (includeRulesets ? this.hasExactCallableChildSurface : this.hasExactMixinChildSurface) {
      return true;
    }
    if (this.directChildRuleEntries !== undefined) {
      return false;
    }
    const value = this.rules;
    for (let i = 0; i < value.length; i++) {
      const childNode = value[i]!;
      const child = childCallableRulesOf(childNode);
      const childHasSurface = includeRulesets
        ? child && (rulesMayContainExactRulesetSurface(child) || (!hidesAmbientMixinSurface(childNode) && rulesMayContainExactMixinSurface(child)))
        : child && !hidesAmbientMixinSurface(childNode) && rulesMayContainExactMixinSurface(child);
      if (childHasSurface) {
        return true;
      }
    }
    return false;
  }

  private invalidateExactCallableSurfaceSummaries(): void {
    this.mayContainExactMixinSurface = undefined;
    this.mayContainExactRulesetSurface = undefined;
    let current = this.sourceParent;
    while (current) {
      if (isNode(current, N.Rules)) {
        current.mayContainExactMixinSurface = undefined;
        current.mayContainExactRulesetSurface = undefined;
      }
      current = current.sourceParent;
    }
  }

  private invalidateReferenceImportSurfaceSummary(): void {
    let current: Node | undefined = this;
    while (current) {
      if (isNode(current, N.Rules)) {
        current.mayContainReferenceImportSurface = undefined;
      }
      current = current.sourceParent;
    }
  }

  setFunctionBinding(name: string | undefined, node: JsFunction | Func): void {
    if (!name) {
      return;
    }
    this.functionLookupVersion++;
    const versions = this.functionLookupVersionsByName ??= new Map();
    versions.set(name, (versions.get(name) ?? 0) + 1);
    (this.functionsByName ??= new Map()).set(name, node);
  }

  /**
   * Fast parent-chain walk for static-named callable mixin lookup.
   *
   * Covers callable entries from the lazy callable cache:
   * static Mixins plus static Ruleset-as-mixin keys.
   * Compound / namespace cases use the direct namespace path in
   * `findMixin(...)`.
   */
  findMixinsFast(
    key: string,
    options?: ExactCallableFindOptions
  ): MixinEntry[] {
    let results: MixinEntry[] | undefined;
    const includeRulesets = options?.includeRulesets !== false;

    let cursor: Node | undefined = this;
    let first = true;
    while (cursor) {
      if (isNode(cursor, N.Rules)) {
        const scope = cursor as Rules;
        if (!first) {
          if (isNonClassicImportBoundary(scope)) {
            break;
          }
        }
        first = false;
        results = scope.collectMixinsFastWithinScopeSurface(
          key,
          options,
          includeRulesets,
          results,
          scope,
          options?.local,
          undefined,
          options?.skipCurrentSurface !== true
        );
      }
      cursor = cursor.sourceParent;
      if (options?.searchParents === false) {
        break;
      }
    }
    return results ?? [];
  }

  private collectMixinsFastWithinScopeSurface(
    key: string,
    options: ExactCallableFindOptions | undefined,
    includeRulesets: boolean,
    results: MixinEntry[] | undefined,
    scope: Rules,
    localContext: boolean | undefined,
    visited?: Set<Rules>,
    includeCurrentSurface = true
  ): MixinEntry[] | undefined {
    if (visited?.has(scope)) {
      return results;
    }
    if (visited) {
      visited.add(scope);
    }

    if (includeCurrentSurface) {
      const candidates = scope.getCallableEntriesForKey(key);
      if (candidates.length > 0) {
        results = appendCallableBucketResults(candidates, includeRulesets, results);
      }
    }

    if (scope.directChildRuleEntries === null) {
      return results;
    }
    const childEntries = scope.directChildRuleEntries !== undefined
      ? (scope.directChildRuleEntries ?? undefined)
      : scope.collectDirectChildRulesEntries();
    if (!childEntries?.length) {
      return results;
    }

    visited ??= new Set<Rules>([scope]);
    for (let i = childEntries.length - 1; i >= 0; i--) {
      const entry = childEntries[i]!;
      if (!canEnterRulesEntryForLookup(entry, { type: 'Mixin', hasTarget: options?.hasTarget })) {
        continue;
      }
      if (
        !includeRulesets
        && entry.hasExactMixinSurface === false
        && entry.hasReferenceImportSurface !== true
      ) {
        continue;
      }
      if (entry.node.options?.forward) {
        continue;
      }
      if (localContext && entry.node.options?.local) {
        continue;
      }
      results = this.collectMixinsFastWithinScopeSurface(
        key,
        options,
        includeRulesets,
        results,
        entry.node,
        localContext || Boolean(entry.node.options?.local),
        visited,
        true
      );
    }

    return results;
  }

  private findMixinsFastForUncoveredCallable(
    key: string,
    reason: Extract<ScopeFrameCallableLookupResult, { kind: 'uncovered' }>['reason'],
    includeRulesets: boolean,
    options: CallableFindOptions
  ): UncoveredCallableResult {
    if (reason !== 'child-surface' && reason !== 'reference-import') {
      return UNCOVERED_CALLABLE_UNSUPPORTED;
    }
    const childEntries = this.directChildRuleEntries !== undefined
      ? (this.directChildRuleEntries ?? undefined)
      : this.collectDirectChildRulesEntries();
    if (!childEntries?.length) {
      return UNCOVERED_CALLABLE_MISS;
    }
    let firstUncoveredChild: Rules | undefined;
    let uncoveredChildren: Rules[] | undefined;
    let frameResults: MixinEntry[] | undefined;
    let modeledChildSurface = false;
    for (let i = childEntries.length - 1; i >= 0; i--) {
      const entry = childEntries[i]!;
      if (!canEnterRulesEntryForLookup(entry, { type: 'Mixin', hasTarget: options.hasTarget })) {
        continue;
      }
      if (includeRulesets) {
        if (
          entry.hasExactCallableSurface === false
          && !(reason === 'reference-import' && entry.hasReferenceImportSurface === true)
        ) {
          continue;
        }
      } else if (
        entry.hasExactMixinSurface === false
        && !(reason === 'reference-import' && entry.hasReferenceImportSurface === true)
      ) {
        continue;
      }
      if (entry.node.options?.forward) {
        continue;
      }
      if (options.local && entry.node.options?.local) {
        continue;
      }
      if (reason === 'child-surface' || entry.hasReferenceImportSurface === true) {
        modeledChildSurface = true;
      }
      const childFrame = entry.node.getScopeFrame();
      entry.node.prepareCallableLookupFrame(childFrame, key, includeRulesets);
      const frameHit = lookupScopeFrameCallable(childFrame, key, {
        includeRulesets,
        searchParents: false
      });
      if (frameHit.kind === 'hit') {
        const results = collectCallableBucketResults(frameHit.bucket, includeRulesets);
        if (results) {
          (frameResults ??= []).push(...results);
        }
      } else if (
        frameHit.kind === 'uncovered'
        && (
          frameHit.reason !== 'reference-import'
          || (includeRulesets ? entry.hasExactCallableSurface : entry.hasExactMixinSurface)
        )
      ) {
        if (firstUncoveredChild === undefined) {
          firstUncoveredChild = entry.node;
        } else {
          (uncoveredChildren ??= [firstUncoveredChild]).push(entry.node);
        }
      }
    }
    if (frameResults) {
      return frameResults;
    }
    if (!firstUncoveredChild) {
      return modeledChildSurface ? UNCOVERED_CALLABLE_MISS : UNCOVERED_CALLABLE_UNSUPPORTED;
    }
    if (uncoveredChildren) {
      for (let i = 0; i < uncoveredChildren.length; i++) {
        const direct = uncoveredChildren[i]!.findMixinsFast(key, {
          hasTarget: options.hasTarget,
          local: options.local,
          includeRulesets,
          searchParents: false
        });
        if (direct.length > 0) {
          (frameResults ??= []).push(...direct);
        }
      }
    } else {
      const direct = firstUncoveredChild.findMixinsFast(key, {
        hasTarget: options.hasTarget,
        local: options.local,
        includeRulesets,
        searchParents: false
      });
      if (direct.length > 0) {
        frameResults = direct;
      }
    }
    return frameResults ?? UNCOVERED_CALLABLE_UNSUPPORTED;
  }

  private addCallableEntry(
    lookupKey: string,
    key: string | undefined,
    value: MixinEntry,
    match: string[],
    bucket: CallableLookupEntry[]
  ): void {
    if (!key || key !== lookupKey || key.startsWith(':')) {
      return;
    }
    bucket.push({ value, match });
  }

  private addDirectCallableSelectorEntries(
    lookupKey: string,
    ruleset: Ruleset,
    keys: string[],
    bucket: CallableLookupEntry[],
    startAt = 0
  ): void {
    let key: string | undefined;
    let match: string[] | undefined;
    for (let i = startAt; i < keys.length; i++) {
      const candidate = keys[i]!;
      if (candidate.startsWith(':')) {
        continue;
      }
      if (key === undefined) {
        if (!candidate.startsWith('*')) {
          key = candidate;
        }
        continue;
      }
      (match ??= []).push(candidate);
    }
    if (key === undefined) {
      return;
    }
    this.addCallableEntry(lookupKey, key, ruleset, match ?? [], bucket);
  }

  private collectCallableEntriesForKeyFrom(
    rules: Rules,
    lookupKey: string,
    bucket: CallableLookupEntry[]
  ): void {
    const value = rules.rules;
    for (let i = 0; i < value.length; i++) {
      const node = value[i]!;
      const nodeType = node.nodeType ?? 0;
      if ((nodeType & N.Mixin) !== 0) {
        const name = node.name;
        if (name && name.type !== 'Interpolated') {
          const entry = node.sourceParent === rules
            ? node
            : callableRulesEntry({
                name: node.name,
                params: node.params,
                rules: node.rules,
                guard: node.guard
              }, rules, node.index);
          this.addCallableEntry(lookupKey, String(name.valueOf()), entry, [], bucket);
        }
        continue;
      }
      if ((nodeType & N.Rules) !== 0) {
        if (!canEnterRulesEntryForLookup({ node }, { type: 'Mixin' })) {
          continue;
        }
        const childEntries = node.getCallableEntriesForKey(lookupKey, false);
        for (let childIndex = 0; childIndex < childEntries.length; childIndex++) {
          bucket.push(childEntries[childIndex]!);
        }
        continue;
      }
      if ((nodeType & N.Ruleset) === 0) {
        continue;
      }
      let selector = node.selector;
      if (((selector.nodeType ?? 0) & N.Nil) !== 0) {
        continue;
      }
      const ownSelector = isSelectorLikeNode(node.options.ownSelector)
        ? node.options.ownSelector
        : undefined;
      const callableSelector = ownSelector && ((ownSelector.nodeType ?? 0) & N.Nil) === 0 ? ownSelector : selector;
      if (((callableSelector.nodeType ?? 0) & N.Ampersand) !== 0) {
        continue;
      }
      const sourceSelector = isSelectorLikeNode(selector.sourceNode)
        ? selector.sourceNode
        : undefined;
      let keys = getOrderedSelectorKeys(selector);
      if (keys.length === 0 && sourceSelector) {
        const sourceKeys = getOrderedSelectorKeys(sourceSelector);
        if (sourceKeys.length > 0) {
          selector = sourceSelector;
          keys = sourceKeys;
        }
      }
      if (((selector.nodeType ?? 0) & N.SelectorList) !== 0) {
        for (let selectorIndex = 0; selectorIndex < selector.value.length; selectorIndex++) {
          this.addDirectCallableSelectorEntries(
            lookupKey,
            node,
            getOrderedSelectorKeys(selector.value[selectorIndex]!),
            bucket
          );
        }
        continue;
      }
      if (keys.length > 0 && ownSelector && ((ownSelector.nodeType ?? 0) & N.Nil) === 0) {
        const parentSource = node.sourceParent?.sourceParent;
        const parentSelector = parentSource && ((parentSource.nodeType ?? 0) & N.Ruleset) !== 0
          ? (node.sourceParent.sourceParent as Ruleset).selector
          : undefined;
        const parentKeys = parentSelector && ((parentSelector.nodeType ?? 0) & N.Nil) === 0
          ? getOrderedSelectorKeys(parentSelector)
          : [];
        if (
          parentKeys.length > 0
          && keys.length > parentKeys.length
          && keysStartWith(keys, parentKeys)
        ) {
          this.addDirectCallableSelectorEntries(lookupKey, node, keys, bucket, parentKeys.length);
          continue;
        }
      }
      this.addDirectCallableSelectorEntries(lookupKey, node, keys, bucket);
    }
  }

  private getCallableEntriesForKey(
    lookupKey: string,
    updateFrameMissCoverage = true
  ): CallableLookupEntry[] {
    const entries = this.callableLookupCache;
    if (entries?.has(lookupKey)) {
      return entries.get(lookupKey) ?? [];
    }

    const bucket: CallableLookupEntry[] = [];
    this.collectCallableEntriesForKeyFrom(this, lookupKey, bucket);
    const sourceRules = sourceRulesOf(this);
    if (bucket.length === 0 && sourceRules !== this) {
      this.collectCallableEntriesForKeyFrom(sourceRules, lookupKey, bucket);
    }
    (this.callableLookupCache ??= new Map()).set(
      lookupKey,
      bucket.length === 0 ? null : bucket
    );
    if (this._scopeFrame) {
      this._scopeFrame.callableBucketsByName = this.callableLookupCache;
      this._scopeFrame.callablesCovered = true;
      if (updateFrameMissCoverage) {
        this._scopeFrame.callableMissesCovered = !this.hasDirectLookupChildSurface();
        this._scopeFrame.callableMissCoverageKnown = true;
        this._scopeFrame.mixinCallableMissesCovered = !this.hasDirectLookupChildSurface(false);
        this._scopeFrame.mixinCallableMissCoverageKnown = true;
      }
    }
    return bucket;
  }

  private prepareCallableLookupFrame(frame: ScopeFrame, key: string, includeRulesets: boolean): void {
    if (isNode(frame.rulesNode, N.Rules)) {
      const rules = frame.rulesNode;
      if (!rules.callableLookupCache?.has(key)) {
        rules.getCallableEntriesForKey(key, false);
      }
      const coverageKnown = includeRulesets
        ? frame.callableMissCoverageKnown
        : frame.mixinCallableMissCoverageKnown;
      if (
        frame.callableBucketsByName === rules.callableLookupCache
        && frame.callablesCovered
        && coverageKnown
      ) {
        return;
      }
      frame.callableBucketsByName = rules.callableLookupCache;
      frame.callablesCovered = true;
      if (includeRulesets && !frame.callableMissCoverageKnown) {
        frame.callableMissesCovered = !rules.hasDirectLookupChildSurface();
        frame.callableMissCoverageKnown = true;
      } else if (!includeRulesets && !frame.mixinCallableMissCoverageKnown) {
        frame.mixinCallableMissesCovered = !rules.hasDirectLookupChildSurface(false);
        frame.mixinCallableMissCoverageKnown = true;
      }
    }
  }

  collectDirectChildRulesEntries(): Array<RulesEntryLike> | undefined {
    if (this.directChildRuleEntries !== undefined) {
      return this.directChildRuleEntries ?? undefined;
    }
    let out: Array<RulesEntryLike> | undefined;
    const value = this.rules;
    for (let i = 0; i < value.length; i++) {
      const childNode = value[i]!;
      const child = childCallableRulesOf(childNode);
      if (!child) {
        continue;
      }
      const hasReferenceImportSurface = rulesMayContainReferenceImports(child);
      this.hasReferenceImportChildSurface ||= hasReferenceImportSurface;
      const hiddenAmbientMixinSurface = hidesAmbientMixinSurface(childNode);
      const hasExactRulesetSurface = rulesMayContainExactRulesetSurface(child);
      const hasExactMixinSurface = !hiddenAmbientMixinSurface && rulesMayContainExactMixinSurface(child);
      const hasExactCallableSurface = hasExactMixinSurface || hasExactRulesetSurface;
      if (!hasReferenceImportSurface && !hasExactCallableSurface) {
        continue;
      }
      if (hasExactCallableSurface) {
        this.hasExactCallableChildSurface = true;
        if (hasExactMixinSurface) {
          this.hasExactMixinChildSurface = true;
        }
        if (hasExactRulesetSurface) {
          this.hasExactRulesetChildSurface = true;
        }
      }
      (out ??= []).push({
        node: child,
        rulesVisibility: this.getDirectChildRulesVisibility(child),
        readonly: Boolean(child.options.readonly),
        hasReferenceImportSurface,
        hasExactCallableSurface,
        hasExactMixinSurface,
        hasExactRulesetSurface
      });
    }
    this.directChildRuleEntries = out ?? null;
    return out;
  }

  collectDirectDeclarationChildEntries(): Array<RulesEntryLike> | undefined {
    if (this.directDeclarationChildEntries !== undefined) {
      return this.directDeclarationChildEntries ?? undefined;
    }
    let out: Array<RulesEntryLike> | undefined;
    const value = this.rules;
    for (let i = 0; i < value.length; i++) {
      const child = childRulesOf(value[i]!);
      if (!child) {
        continue;
      }
      const hasDeclarationSurface = rulesMayContainDeclarationSurface(child);
      const hasVarDeclarationSurface = rulesMayContainVarDeclarationSurface(child);
      const hasMergeDeclarationSurface = hasDeclarationSurface && rulesMayContainMergeDeclarationSurface(child);
      const hasReferenceImportSurface = rulesMayContainReferenceImports(child);
      this.hasDeclarationChildSurface ||= hasDeclarationSurface;
      this.hasVarDeclarationChildSurface ||= hasVarDeclarationSurface;
      this.hasMergeDeclarationChildSurface ||= hasMergeDeclarationSurface;
      this.hasReferenceImportChildSurface ||= hasReferenceImportSurface;
      const entry: RulesEntryLike = {
        node: child,
        rulesVisibility: this.getDirectChildRulesVisibility(child),
        readonly: Boolean(child.options.readonly),
        hasDeclarationSurface,
        hasVarDeclarationSurface,
        hasMergeDeclarationSurface,
        hasReferenceImportSurface,
        hasUncoveredAssignmentTargetSurface: child.getHasUncoveredAssignmentTargetEntrySurface()
      };
      child.collectPublicVariableAssignmentBindingsInto(Boolean(child.options.readonly), entry);
      (out ??= []).push(entry);
    }
    this.directDeclarationChildEntries = out ?? null;
    return out;
  }

  private getDirectChildRulesVisibility(child: Rules): RulesOptions['rulesVisibility'] {
    return mergeDirectChildRulesVisibility(child.options.rulesVisibility, undefined);
  }

  private addDirectDeclarationChildRuleEntry(
    child: Rules,
    rulesVisibility?: RulesOptions['rulesVisibility'],
    readonly = Boolean(child.options.readonly)
  ): void {
    this.hasDirectChildRuleSurface = true;
    const hasDeclarationSurface = rulesMayContainDeclarationSurface(child);
    const hasVarDeclarationSurface = rulesMayContainVarDeclarationSurface(child);
    const hasMergeDeclarationSurface = hasDeclarationSurface && rulesMayContainMergeDeclarationSurface(child);
    const hasReferenceImportSurface = rulesMayContainReferenceImports(child);
    this.hasDeclarationChildSurface ||= hasDeclarationSurface;
    this.hasVarDeclarationChildSurface ||= hasVarDeclarationSurface;
    this.hasMergeDeclarationChildSurface ||= hasMergeDeclarationSurface;
    this.hasReferenceImportChildSurface ||= hasReferenceImportSurface;
    if (this.directDeclarationChildEntries === undefined) {
      return;
    }
    const visibility = mergeDirectChildRulesVisibility(child.options.rulesVisibility, rulesVisibility);
    const entries = this.directDeclarationChildEntries ?? (this.directDeclarationChildEntries = []);
    const entry: RulesEntryLike = {
      node: child,
      rulesVisibility: visibility,
      readonly,
      hasDeclarationSurface,
      hasVarDeclarationSurface,
      hasMergeDeclarationSurface,
      hasReferenceImportSurface,
      hasUncoveredAssignmentTargetSurface: child.getHasUncoveredAssignmentTargetEntrySurface()
    };
    child.collectPublicVariableAssignmentBindingsInto(readonly, entry);
    entries.push(entry);
  }

  private refreshDirectDeclarationChildEntryAssignmentSummary(child: Rules, changedVariable?: VarDeclaration): void {
    const entries = this.directDeclarationChildEntries;
    if (!entries?.length) {
      return;
    }
    let patched = false;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      if (entry.node !== child) {
        continue;
      }
      if (changedVariable) {
        entry.hasDeclarationSurface = true;
        entry.hasVarDeclarationSurface = true;
        if (!child._hasStaticName(changedVariable)) {
          if (isPublicRulesEntry(entry, 'VarDeclaration')) {
            entry.hasUncoveredAssignmentTargetSurface = true;
            if (this._scopeFrame) {
              this._scopeFrame.hasUncoveredAssignmentTargetSurface = true;
            }
          }
          patched = true;
          continue;
        }
        if (
          !changedVariable.options?.setDefined
          && isPublicRulesEntry(entry, 'VarDeclaration')
          && canEnterRulesEntryForLookup(entry, { type: 'VarDeclaration' })
          && canEnterMixinOutputForLookup(entry, { type: 'VarDeclaration' })
        ) {
          const name = String(changedVariable.name.valueOf());
          const varEntries = child.varsByName?.get(name);
          let varEntry: BindingEntry | undefined;
          if (varEntries?.length) {
            for (let i = varEntries.length - 1; i >= 0; i--) {
              const candidate = varEntries[i]!;
              if (candidate.sourceNode === changedVariable) {
                varEntry = candidate;
                break;
              }
            }
          }
          const cell = varEntry?.cell ?? {
            value: changedVariable.valueNode,
            sourceNode: changedVariable,
            readonly: Boolean(changedVariable.options?.readonly)
          };
          (entry.assignmentBindingsByName ??= new Map()).set(name, cell);
          if (entry.readonly && !cell.readonly) {
            (entry.assignmentReadonlyByName ??= new Set()).add(name);
          } else {
            entry.assignmentReadonlyByName?.delete(name);
          }
          if (
            this._scopeFrame
            && !this._scopeFrame.currentBindingsByName.has(name)
            && this.directDeclarationChildEntryWinsAssignmentName(entries, i, name)
          ) {
            (this._scopeFrame.assignmentBindingsByName ??= new Map()).set(name, cell);
            if (entry.assignmentReadonlyByName?.has(name)) {
              (this._scopeFrame.assignmentReadonlyByName ??= new Set()).add(name);
            } else {
              this._scopeFrame.assignmentReadonlyByName?.delete(name);
            }
          }
          patched = true;
          continue;
        }
      }
      entry.hasDeclarationSurface = rulesMayContainDeclarationSurface(child);
      entry.hasVarDeclarationSurface = rulesMayContainVarDeclarationSurface(child);
      entry.hasReferenceImportSurface = rulesMayContainReferenceImports(child);
      entry.assignmentBindingsByName = undefined;
      entry.assignmentReadonlyByName = undefined;
      child.collectPublicVariableAssignmentBindingsInto(Boolean(entry.readonly), entry);
      entry.hasUncoveredAssignmentTargetSurface = child.getHasUncoveredAssignmentTargetEntrySurface();
    }
    if (changedVariable && patched) {
      return;
    }
    if (this._scopeFrame) {
      this._scopeFrame.assignmentBindingsByName = undefined;
      this._scopeFrame.assignmentReadonlyByName = undefined;
      this._scopeFrame.hasUncoveredAssignmentTargetSurface = false;
      this.prepareScopeFrameAssignmentBindings(this._scopeFrame);
    }
  }

  private directDeclarationChildEntryWinsAssignmentName(
    entries: Array<RulesEntryLike>,
    entryIndex: number,
    name: string
  ): boolean {
    for (let i = entries.length - 1; i > entryIndex; i--) {
      const entry = entries[i]!;
      if (
        entry.hasVarDeclarationSurface === false
        && entry.hasReferenceImportSurface !== true
      ) {
        continue;
      }
      if (!canEnterRulesEntryForLookup(entry, { type: 'VarDeclaration' })) {
        continue;
      }
      if (!canEnterMixinOutputForLookup(entry, { type: 'VarDeclaration' })) {
        continue;
      }
      if (!isPublicRulesEntry(entry, 'VarDeclaration')) {
        continue;
      }
      if (entry.assignmentBindingsByName?.has(name)) {
        return false;
      }
    }
    return true;
  }

  private refreshParentDeclarationChildEntryAssignmentSummary(changedVariable?: VarDeclaration): void {
    if (isNode(this.sourceParent, N.Rules)) {
      this.sourceParent.refreshDirectDeclarationChildEntryAssignmentSummary(this, changedVariable);
    }
  }

  private addDirectChildRuleEntry(
    child: Rules,
    rulesVisibility?: RulesOptions['rulesVisibility'],
    readonly = Boolean(child.options.readonly)
  ): void {
    this.hasDirectChildRuleSurface = true;
    const hasReferenceImportSurface = rulesMayContainReferenceImports(child);
    const hasExactCallableSurface = rulesMayContainExactCallableSurface(child);
    const hasExactMixinSurface = hasExactCallableSurface && rulesMayContainExactMixinSurface(child);
    const hasExactRulesetSurface = hasExactCallableSurface && rulesMayContainExactRulesetSurface(child);
    this.hasReferenceImportChildSurface ||= hasReferenceImportSurface;
    if (hasExactCallableSurface) {
      this.hasExactCallableChildSurface = true;
      if (hasExactMixinSurface) {
        this.hasExactMixinChildSurface = true;
      }
      if (hasExactRulesetSurface) {
        this.hasExactRulesetChildSurface = true;
      }
    }
    if (!hasReferenceImportSurface && !hasExactCallableSurface) {
      return;
    }
    const visibility = mergeDirectChildRulesVisibility(child.options.rulesVisibility, rulesVisibility);

    if (this.directChildRuleEntries === undefined) {
      return;
    }
    const entries = this.directChildRuleEntries ?? (this.directChildRuleEntries = []);
    entries.push({
      node: child,
      rulesVisibility: visibility,
      readonly,
      hasReferenceImportSurface,
      hasExactCallableSurface,
      hasExactMixinSurface,
      hasExactRulesetSurface
    });
  }

  private findVisibleExactCallableRulesetPath(
    path: string[],
    options?: {
      hasTarget?: boolean;
      local?: boolean;
      searchParents?: boolean;
      context?: Context;
    }
  ): Ruleset[] {
    const results: Ruleset[] = [];
    let cursor: Node | undefined = this;
    let first = true;
    while (cursor) {
      if (isNode(cursor, N.Rules)) {
        const scope = cursor as Rules;
        if (!first) {
          if (isNonClassicImportBoundary(scope)) {
            break;
          }
        }
        first = false;
        this.collectVisibleExactCallableRulesetPathSurface(scope, path, options, options?.local, results);
      }
      if (options?.searchParents === false) {
        break;
      }
      cursor = cursor.sourceParent;
    }
    return results;
  }

  private collectVisibleExactCallableRulesetPathSurface(
    scope: Rules,
    path: string[],
    options: {
      hasTarget?: boolean;
      local?: boolean;
      searchParents?: boolean;
      context?: Context;
    } | undefined,
    localContext: boolean | undefined,
    results: Ruleset[],
    visited?: Set<Rules>
  ): void {
    if (visited?.has(scope)) {
      return;
    }
    if (visited) {
      visited.add(scope);
    }

    for (let i = scope.rules.length - 1; i >= 0; i--) {
      const candidate = scope.rules[i]!;
      if (!isNode(candidate, N.Ruleset)) {
        continue;
      }
      const keyPaths = getCallableRulesetKeyPaths(candidate);
      for (let keyPathIndex = 0; keyPathIndex < keyPaths.length; keyPathIndex++) {
        const keys = keyPaths[keyPathIndex]!;
        if (
          keys.length === path.length
          && keysStartWith(keys, path)
        ) {
          results.push(candidate);
          break;
        }
      }
    }

    if (scope.directChildRuleEntries !== undefined && !scope.hasExactRulesetChildSurface) {
      return;
    }
    const childEntries = scope.directChildRuleEntries !== undefined
      ? (scope.directChildRuleEntries ?? undefined)
      : scope.collectDirectChildRulesEntries();
    if (!childEntries?.length) {
      return;
    }

    visited ??= new Set<Rules>([scope]);
    for (let i = childEntries.length - 1; i >= 0; i--) {
      const entry = childEntries[i]!;
      if (!canEnterRulesEntryForLookup(entry, { type: 'Mixin', hasTarget: options?.hasTarget })) {
        continue;
      }
      if (entry.hasExactRulesetSurface === false) {
        continue;
      }
      if (entry.node.options?.forward) {
        continue;
      }
      if (localContext && entry.node.options?.local) {
        continue;
      }
      this.collectVisibleExactCallableRulesetPathSurface(
        entry.node,
        path,
        options,
        localContext || Boolean(entry.node.options?.local),
        results,
        visited
      );
    }
  }

  private findVisibleCallableRulesetPrefixMatches(
    path: string[],
    options?: {
      hasTarget?: boolean;
      local?: boolean;
      searchParents?: boolean;
      context?: Context;
    }
  ): CallableRulesetPrefixMatch[] {
    const results: CallableRulesetPrefixMatch[] = [];
    let cursor: Node | undefined = this;
    let first = true;
    while (cursor) {
      if (isNode(cursor, N.Rules)) {
        const scope = cursor as Rules;
        if (!first) {
          if (isNonClassicImportBoundary(scope)) {
            break;
          }
        }
        first = false;
        this.collectVisibleCallableRulesetPrefixMatchSurface(scope, path, options, options?.local, results);
      }
      if (options?.searchParents === false) {
        break;
      }
      cursor = cursor.sourceParent;
    }
    return results;
  }

  private collectVisibleCallableRulesetPrefixMatchSurface(
    scope: Rules,
    path: string[],
    options: {
      hasTarget?: boolean;
      local?: boolean;
      searchParents?: boolean;
      context?: Context;
    } | undefined,
    localContext: boolean | undefined,
    results: CallableRulesetPrefixMatch[],
    visited?: Set<Rules>
  ): void {
    if (visited?.has(scope)) {
      return;
    }
    if (visited) {
      visited.add(scope);
    }

    for (let i = scope.rules.length - 1; i >= 0; i--) {
      const candidate = scope.rules[i]!;
      if (!isNode(candidate, N.Ruleset)) {
        continue;
      }
      const keyPaths = getCallableRulesetKeyPaths(candidate);
      for (let keyPathIndex = 0; keyPathIndex < keyPaths.length; keyPathIndex++) {
        const keys = keyPaths[keyPathIndex]!;
        if (
          keys.length > 0
          && keys.length < path.length
          && keysStartWith(path, keys)
        ) {
          results.push({ ruleset: candidate, consumed: keys, scope });
        }
      }
    }

    if (scope.directChildRuleEntries !== undefined && !scope.hasExactRulesetChildSurface) {
      return;
    }
    const childEntries = scope.directChildRuleEntries !== undefined
      ? (scope.directChildRuleEntries ?? undefined)
      : scope.collectDirectChildRulesEntries();
    if (!childEntries?.length) {
      return;
    }

    visited ??= new Set<Rules>([scope]);
    for (let i = childEntries.length - 1; i >= 0; i--) {
      const entry = childEntries[i]!;
      if (!canEnterRulesEntryForLookup(entry, { type: 'Mixin', hasTarget: options?.hasTarget })) {
        continue;
      }
      if (entry.hasExactRulesetSurface === false) {
        continue;
      }
      if (entry.node.options?.forward) {
        continue;
      }
      if (localContext && entry.node.options?.local) {
        continue;
      }
      this.collectVisibleCallableRulesetPrefixMatchSurface(
        entry.node,
        path,
        options,
        localContext || Boolean(entry.node.options?.local),
        results,
        visited
      );
    }
  }

  findMixinNamespacePathFast(
    keys: string[],
    filterType: 'Mixin' | undefined,
    options: CallableFindOptions = {},
    pathStart = 0
  ): MixinEntry[] | undefined {
    if (keys.length - pathStart < 2) {
      return undefined;
    }

    const walk = (
      scope: Rules,
      path: string[],
      offset: number,
      searchParents: boolean
    ): CallableNamespaceFastResult => {
      const segment = path[offset];
      const restLength = path.length - offset - 1;
      if (!segment) {
        return DEFINITE_MIXIN_NAMESPACE_MISS;
      }

      const includeRulesets = filterType !== 'Mixin' && (restLength > 0 || options.terminalMixinOnly !== true);
      let matches: MixinEntry[] | undefined;
      if (scope._scopeFrame && !options.hasTarget && !options.local) {
        scope.prepareCallableLookupFrame(scope._scopeFrame, segment, includeRulesets);
        const frameHit = lookupScopeFrameCallable(scope._scopeFrame, segment, {
          includeRulesets,
          searchParents
        });
        let frameMissCovered = false;
        if (frameHit.kind === 'hit') {
          const remainderMatches = collectCallableBucketRemainderResults(
            frameHit.bucket,
            includeRulesets,
            path,
            offset
          );
          if (remainderMatches) {
            return {
              entries: remainderMatches,
              owned: true
            };
          }
          matches = collectCallableBucketResults(frameHit.bucket, includeRulesets);
        } else if (frameHit.kind === 'miss') {
          frameMissCovered = true;
        } else if (
          frameHit.kind === 'uncovered'
          && (frameHit.reason === 'child-surface' || frameHit.reason === 'reference-import')
        ) {
          const direct = scope.findMixinsFastForUncoveredCallable(
            segment,
            frameHit.reason,
            includeRulesets,
            options
          );
          if (direct !== UNCOVERED_CALLABLE_UNSUPPORTED) {
            frameMissCovered = true;
            if (direct.length > 0) {
              matches = direct;
            }
          }
        }
        if (matches === undefined && frameMissCovered) {
          let fallbackFrame = scope._scopeFrame.fallbackFrame;
          while (fallbackFrame && matches === undefined) {
            if (isNode(fallbackFrame.rulesNode, N.Rules)) {
              fallbackFrame.rulesNode.prepareCallableLookupFrame(fallbackFrame, segment, includeRulesets);
            }
            const fallbackHit = lookupScopeFrameCallable(fallbackFrame, segment, {
              includeRulesets,
              searchParents: false
            });
            if (fallbackHit.kind === 'hit') {
              const remainderMatches = collectCallableBucketRemainderResults(
                fallbackHit.bucket,
                includeRulesets,
                path,
                offset
              );
              if (remainderMatches) {
                matches = remainderMatches;
                break;
              }
              matches = collectCallableBucketResults(fallbackHit.bucket, includeRulesets);
              break;
            }
            if (
              fallbackHit.kind === 'uncovered'
              && (fallbackHit.reason === 'child-surface' || fallbackHit.reason === 'reference-import')
            ) {
              if (isNode(fallbackFrame.rulesNode, N.Rules)) {
                const directFallback = fallbackFrame.rulesNode.findMixinsFastForUncoveredCallable(
                  segment,
                  fallbackHit.reason,
                  includeRulesets,
                  options
                );
                if (directFallback !== UNCOVERED_CALLABLE_UNSUPPORTED) {
                  matches = directFallback;
                  break;
                }
              }
              break;
            }
            fallbackFrame = fallbackFrame.fallbackFrame;
          }
          if (matches === undefined) {
            return DEFINITE_MIXIN_NAMESPACE_MISS;
          }
        }
      }
      if (matches === undefined && restLength > 0) {
        const remainderMatches = collectCallableBucketRemainderResults(
          scope.getCallableEntriesForKey(segment),
          includeRulesets,
          path,
          offset
        );
        if (remainderMatches) {
          return {
            entries: remainderMatches,
            owned: true
          };
        }
      }
      matches ??= scope.findMixinsFast(segment, {
        hasTarget: options.hasTarget,
        local: options.local,
        includeRulesets,
        searchParents
      });

      if (matches.length === 0) {
        return DEFINITE_MIXIN_NAMESPACE_MISS;
      }
      if (restLength === 0) {
        return { entries: matches, owned: true };
      }

      let nestedResults: MixinEntry[] | undefined;
      let nestedResultsOwned = false;
      let sawDefiniteMiss = false;
      for (const match of matches) {
        let nestedScope: Rules;
        let rulesetNamespace: Ruleset | undefined;
        let callableNamespace: CallableEntry | undefined;
        if (isNode(match, N.Ruleset)) {
          if (!includeRulesets) {
            return undefined;
          }
          rulesetNamespace = match;
          nestedScope = match.rules;
        } else if (isCallableEntry(match)) {
          if (!callableEntryHasNoRequiredParams(match)) {
            sawDefiniteMiss = true;
            continue;
          }
          callableNamespace = match;
          nestedScope = getMixinEntryRules(match);
        } else {
          return undefined;
        }
        const resolved = walk(nestedScope, path, offset + 1, false);
        if (resolved === undefined) {
          return undefined;
        }
        if (resolved === DEFINITE_MIXIN_NAMESPACE_MISS) {
          sawDefiniteMiss = true;
          continue;
        }
        const resolvedEntries = rulesetNamespace
          ? withRulesetNamespaceGuards(resolved.entries, rulesetNamespace)
          : callableNamespace
            ? withCallableNamespaceGuards(resolved.entries, callableNamespace)
            : resolved.entries;
        if (nestedResults === undefined) {
          nestedResults = resolvedEntries;
          nestedResultsOwned = resolved.owned || resolvedEntries !== resolved.entries;
          continue;
        }
        if (!nestedResultsOwned) {
          nestedResults = [...nestedResults];
          nestedResultsOwned = true;
        }
        for (let resolvedIndex = 0; resolvedIndex < resolvedEntries.length; resolvedIndex++) {
          nestedResults.push(resolvedEntries[resolvedIndex]!);
        }
      }

      if (nestedResults !== undefined && nestedResults.length > 0) {
        return {
          entries: nestedResults,
          owned: nestedResultsOwned
        };
      }
      return sawDefiniteMiss ? DEFINITE_MIXIN_NAMESPACE_MISS : undefined;
    };

    const result = walk(this, keys, pathStart, options.searchParents !== false);
    return result === DEFINITE_MIXIN_NAMESPACE_MISS
      ? []
      : result?.entries
        ? normalizeNamespaceCallableResults(result.entries, keys)
        : undefined;
  }

  private callableBucketHasExactMixinNamespace(
    frame: ScopeFrame,
    segment: string
  ): boolean {
    const bucket = frame.callableBucketsByName?.get(segment);
    if (!bucket?.length) {
      return false;
    }
    for (let i = bucket.length - 1; i >= 0; i--) {
      const entry = bucket[i]!;
      if (entry.match.length === 0 && !isNode(entry.value, N.Ruleset)) {
        return true;
      }
    }
    return false;
  }

  private prepareCallableLookupFrameChain(
    frame: ScopeFrame,
    segment: string,
    includeRulesets: boolean,
    searchParents: boolean
  ): void {
    let cursor: ScopeFrame | undefined = frame;
    while (cursor) {
      if (isNode(cursor.rulesNode, N.Rules)) {
        cursor.rulesNode.prepareCallableLookupFrame(cursor, segment, includeRulesets);
      }
      if (!searchParents) {
        break;
      }
      cursor = cursor.parent;
    }
  }

  private frameChainHasExactMixinNamespace(
    frame: ScopeFrame,
    segment: string,
    searchParents: boolean
  ): boolean {
    let cursor: ScopeFrame | undefined = frame;
    while (cursor) {
      if (this.callableBucketHasExactMixinNamespace(cursor, segment)) {
        return true;
      }
      if (!searchParents) {
        break;
      }
      cursor = cursor.parent;
    }
    return false;
  }

  private collectCallableRulesetPrefixMatchesFromFrame(
    frame: ScopeFrame,
    path: string[],
    results: CallableRulesetPrefixMatch[]
  ): void {
    const segment = path[0];
    if (!segment || !isNode(frame.rulesNode, N.Rules)) {
      return;
    }
    const bucket = frame.callableBucketsByName?.get(segment);
    if (!bucket?.length) {
      return;
    }
    const scope = frame.rulesNode as Rules;
    for (let i = bucket.length - 1; i >= 0; i--) {
      const entry = bucket[i]!;
      if (!isNode(entry.value, N.Ruleset)) {
        continue;
      }
      const consumedLength = entry.match.length + 1;
      if (consumedLength >= path.length) {
        continue;
      }
      let matchesPath = true;
      for (let matchIndex = 0; matchIndex < entry.match.length; matchIndex++) {
        if (entry.match[matchIndex] !== path[matchIndex + 1]) {
          matchesPath = false;
          break;
        }
      }
      if (!matchesPath) {
        continue;
      }
      results.push({
        ruleset: entry.value,
        consumed: entry.match.length === 0 ? [segment] : [segment, ...entry.match],
        scope
      });
    }
  }

  private collectChildCallableRulesetPrefixMatchesFromFrames(
    scope: Rules,
    path: string[],
    options: CallableFindOptions,
    results: CallableRulesetPrefixMatch[]
  ): boolean {
    const segment = path[0];
    if (!segment) {
      return true;
    }
    const childEntries = scope.directChildRuleEntries !== undefined
      ? (scope.directChildRuleEntries ?? undefined)
      : scope.collectDirectChildRulesEntries();
    if (!childEntries?.length) {
      return true;
    }
    let covered = true;
    for (let i = childEntries.length - 1; i >= 0; i--) {
      const entry = childEntries[i]!;
      if (!canEnterRulesEntryForLookup(entry, { type: 'Mixin', hasTarget: options.hasTarget })) {
        continue;
      }
      if (entry.hasExactRulesetSurface === false) {
        continue;
      }
      if (entry.node.options?.forward) {
        continue;
      }
      if (options.local && entry.node.options?.local) {
        continue;
      }
      const childFrame = entry.node.getScopeFrame();
      entry.node.prepareCallableLookupFrame(childFrame, segment, true);
      this.collectCallableRulesetPrefixMatchesFromFrame(childFrame, path, results);
      if (
        (!childFrame.callableMissCoverageKnown || !childFrame.callableMissesCovered)
        && !this.prefixOwnsChildRules(scope, entry.node, segment, results)
      ) {
        covered = false;
      }
    }
    return covered;
  }

  private collectVisibleCallableRulesetPrefixMatchesFromFrames(
    frame: ScopeFrame,
    path: string[],
    searchParents: boolean,
    options: CallableFindOptions,
    results: CallableRulesetPrefixMatch[]
  ): boolean {
    const segment = path[0];
    if (!segment) {
      return true;
    }
    let cursor: ScopeFrame | undefined = frame;
    let covered = true;
    let first = true;
    while (cursor) {
      if (!isNode(cursor.rulesNode, N.Rules)) {
        covered = false;
        break;
      }
      const scope = cursor.rulesNode as Rules;
      if (!first && isNonClassicImportBoundary(scope)) {
        break;
      }
      first = false;
      scope.prepareCallableLookupFrame(cursor, segment, true);
      this.collectCallableRulesetPrefixMatchesFromFrame(cursor, path, results);
      if (!this.collectChildCallableRulesetPrefixMatchesFromFrames(scope, path, options, results)) {
        covered = false;
      }
      if (!searchParents) {
        break;
      }
      cursor = cursor.parent;
    }
    return covered;
  }

  private prefixOwnsChildRules(
    scope: Rules,
    entryRules: Rules,
    segment: string,
    prefixMatches: CallableRulesetPrefixMatch[]
  ): boolean {
    const entrySource = sourceRulesOf(entryRules);
    for (let i = 0; i < prefixMatches.length; i++) {
      const { ruleset, consumed, scope: matchScope } = prefixMatches[i]!;
      const matchSource = sourceRulesOf(matchScope);
      if (
        consumed.length > 0
        && consumed[0] === segment
        && (matchScope === entryRules || matchSource === entrySource)
      ) {
        return true;
      }
      if (
        consumed.length === 1
        && consumed[0] === segment
        && sourceRulesOf(ruleset.rules) === entrySource
        && (matchScope === scope || matchSource === sourceRulesOf(scope))
      ) {
        return true;
      }
    }
    return false;
  }

  private childMixinNamespaceUncertaintyIsLimitedToPrefixes(
    scope: Rules,
    segment: string,
    prefixMatches: CallableRulesetPrefixMatch[],
    options: CallableFindOptions
  ): boolean {
    const childEntries = scope.directChildRuleEntries !== undefined
      ? (scope.directChildRuleEntries ?? undefined)
      : scope.collectDirectChildRulesEntries();
    if (!childEntries?.length) {
      return true;
    }
    for (let i = childEntries.length - 1; i >= 0; i--) {
      const entry = childEntries[i]!;
      if (!canEnterRulesEntryForLookup(entry, { type: 'Mixin', hasTarget: options.hasTarget })) {
        continue;
      }
      if (entry.hasExactMixinSurface === false && entry.hasReferenceImportSurface !== true) {
        continue;
      }
      if (entry.node.options?.forward) {
        continue;
      }
      if (options.local && entry.node.options?.local) {
        continue;
      }
      if (!this.prefixOwnsChildRules(scope, entry.node, segment, prefixMatches)) {
        return false;
      }
    }
    return true;
  }

  private visibleChildMixinNamespaceUncertaintyIsLimitedToPrefixes(
    scope: Rules,
    segment: string,
    prefixMatches: CallableRulesetPrefixMatch[],
    searchParents: boolean,
    options: CallableFindOptions
  ): boolean {
    let cursor: Node | undefined = scope;
    let first = true;
    while (cursor) {
      if (isNode(cursor, N.Rules)) {
        const visibleScope = cursor as Rules;
        if (!first && isNonClassicImportBoundary(visibleScope)) {
          break;
        }
        first = false;
        if (!this.childMixinNamespaceUncertaintyIsLimitedToPrefixes(
          visibleScope,
          segment,
          prefixMatches,
          options
        )) {
          return false;
        }
      }
      if (!searchParents) {
        break;
      }
      cursor = cursor.sourceParent;
    }
    return true;
  }

  private findRulesetNamespacePathFast(
    keys: string[],
    options: CallableFindOptions = {},
    pathStart = 0
  ): MixinEntry[] | undefined {
    if (keys.length - pathStart < 2) {
      return undefined;
    }

    const DEFINITE_MISS = Symbol('definite-ruleset-namespace-miss');
    type RulesetNamespaceFastResult = MixinEntry[] | typeof DEFINITE_MISS | undefined;
    const selectorNeedsLegacyFallback = (ruleset: Ruleset): boolean => {
      return blocksAmbientMixinOutputLookup(ruleset.rules);
    };

    const walk = (
      scope: Rules,
      path: string[],
      offset: number,
      searchParents: boolean
    ): RulesetNamespaceFastResult => {
      const segment = path[offset];
      if (!segment) {
        return DEFINITE_MISS;
      }
      const activePath = offset === 0 ? path : collectKeyRemainder(path, offset);
      let prefixMatches: CallableRulesetPrefixMatch[] = [];
      let prefixMatchesCovered = false;
      let hasMixinNamespace = false;
      let mixinNamespaceCovered = false;
      const scopeFrame = !options.hasTarget && !options.local
        ? scope.getScopeFrame()
        : undefined;
      if (scopeFrame) {
        prefixMatchesCovered = this.collectVisibleCallableRulesetPrefixMatchesFromFrames(
          scopeFrame,
          activePath,
          searchParents,
          options,
          prefixMatches
        );
        this.prepareCallableLookupFrameChain(scopeFrame, segment, false, searchParents);
        const frameHit = lookupScopeFrameCallable(scopeFrame, segment, {
          includeRulesets: false,
          searchParents
        });
        if (frameHit.kind === 'hit') {
          hasMixinNamespace = true;
          mixinNamespaceCovered = true;
        } else if (frameHit.kind === 'miss') {
          mixinNamespaceCovered = true;
        } else if (
          frameHit.reason === 'child-surface'
          || frameHit.reason === 'reference-import'
          || frameHit.reason === 'frame'
        ) {
          if (prefixMatchesCovered) {
            mixinNamespaceCovered = true;
          } else if (frameHit.reason === 'reference-import' && prefixMatches.length === 0) {
            const uncovered = scope.findMixinsFastForUncoveredCallable(
              segment,
              frameHit.reason,
              false,
              options
            );
            if (uncovered !== UNCOVERED_CALLABLE_UNSUPPORTED) {
              hasMixinNamespace = uncovered.length > 0;
              mixinNamespaceCovered = true;
            }
          }
          if (!mixinNamespaceCovered && this.frameChainHasExactMixinNamespace(scopeFrame, segment, searchParents)) {
            hasMixinNamespace = true;
            mixinNamespaceCovered = true;
          } else if (
            !mixinNamespaceCovered
            &&            prefixMatches.length > 0
            && this.visibleChildMixinNamespaceUncertaintyIsLimitedToPrefixes(
              scope,
              segment,
              prefixMatches,
              searchParents,
              options
            )
          ) {
            mixinNamespaceCovered = true;
          }
        }
        if (!hasMixinNamespace && mixinNamespaceCovered) {
          let fallbackFrame = scopeFrame.fallbackFrame;
          while (fallbackFrame) {
            if (isNode(fallbackFrame.rulesNode, N.Rules)) {
              fallbackFrame.rulesNode.prepareCallableLookupFrame(fallbackFrame, segment, false);
              const fallbackHit = lookupScopeFrameCallable(fallbackFrame, segment, {
                includeRulesets: false,
                searchParents: false
              });
              if (fallbackHit.kind === 'hit') {
                hasMixinNamespace = true;
                break;
              }
              if (
                fallbackHit.kind === 'uncovered'
                && (fallbackHit.reason === 'child-surface' || fallbackHit.reason === 'reference-import')
              ) {
                const uncovered = fallbackFrame.rulesNode.findMixinsFastForUncoveredCallable(
                  segment,
                  fallbackHit.reason,
                  false,
                  options
                );
                if (uncovered !== UNCOVERED_CALLABLE_UNSUPPORTED) {
                  hasMixinNamespace = uncovered.length > 0;
                  break;
                }
              }
            }
            fallbackFrame = fallbackFrame.fallbackFrame;
          }
        }
        if (!hasMixinNamespace && prefixMatches.length === 0) {
          let fallbackFrame = scopeFrame.fallbackFrame;
          while (fallbackFrame) {
            if (isNode(fallbackFrame.rulesNode, N.Rules)) {
              if (!prefixMatchesCovered) {
                const fallbackPrefixMatches = fallbackFrame.rulesNode.findVisibleCallableRulesetPrefixMatches(activePath, {
                  hasTarget: options.hasTarget,
                  local: options.local,
                  searchParents: false,
                  context: options.context
                });
                if (fallbackPrefixMatches.length > 0) {
                  prefixMatches = fallbackPrefixMatches;
                  break;
                }
              }
            }
            fallbackFrame = fallbackFrame.fallbackFrame;
          }
        }
      }
      if (!prefixMatchesCovered) {
        const directPrefixMatches = scope.findVisibleCallableRulesetPrefixMatches(activePath, {
          hasTarget: options.hasTarget,
          local: options.local,
          searchParents,
          context: options.context
        });
        if (prefixMatches.length === 0) {
          prefixMatches = directPrefixMatches;
        } else if (directPrefixMatches.length > 0) {
          for (let i = 0; i < directPrefixMatches.length; i++) {
            const direct = directPrefixMatches[i]!;
            let found = false;
            for (let existing = 0; existing < prefixMatches.length; existing++) {
              const current = prefixMatches[existing]!;
              if (current.ruleset === direct.ruleset && current.scope === direct.scope) {
                found = true;
                break;
              }
            }
            if (!found) {
              prefixMatches.push(direct);
            }
          }
        }
      }
      if (!mixinNamespaceCovered) {
        hasMixinNamespace = scope.findMixinsFast(segment, {
          hasTarget: options.hasTarget,
          local: options.local,
          includeRulesets: false,
          searchParents
        }).length > 0;
      }
      if (hasMixinNamespace && prefixMatches.length === 0) {
        return undefined;
      }

      if (prefixMatches.length === 0) {
        if (options.terminalMixinOnly === true) {
          return DEFINITE_MISS;
        }
        const exactPathMatches = scope.findVisibleExactCallableRulesetPath(activePath, {
          hasTarget: options.hasTarget,
          local: options.local,
          searchParents,
          context: options.context
        });
        return exactPathMatches.length > 0 ? exactPathMatches : DEFINITE_MISS;
      }

      if (prefixMatches.length > 1) {
        prefixMatches.sort((a, b) => b.consumed.length - a.consumed.length);
      }
      let sawLegacyOnlyPrefix = false;
      let simpleLookupOptions: ExactCallableFindOptions | undefined;
      let nestedOptions: CallableFindOptions | undefined;
      let resolvedEntries: MixinEntry[] | undefined;
      let resolvedEntriesOwned = false;

      for (const { ruleset, consumed } of prefixMatches) {
        if (selectorNeedsLegacyFallback(ruleset)) {
          sawLegacyOnlyPrefix = true;
          continue;
        }
        const remainderStart = offset + consumed.length;
        const remainderLength = path.length - remainderStart;
        if (remainderLength === 0) {
          if (options.terminalMixinOnly === true) {
            continue;
          }
          (resolvedEntries ??= []).push(ruleset);
          resolvedEntriesOwned = true;
          continue;
        }
        let resolved: MixinEntry[] | undefined;
        if (remainderLength === 1) {
          const segment = path[remainderStart]!;
          simpleLookupOptions ??= {
            hasTarget: options.hasTarget,
            local: options.local,
            includeRulesets: options.terminalMixinOnly !== true,
            searchParents: false
          };
          let simpleCallableCovered = false;
          const simpleFrame = !options.hasTarget && !options.local
            ? ruleset.rules.getScopeFrame()
            : undefined;
          if (simpleFrame) {
            const includeRulesets = simpleLookupOptions.includeRulesets !== false;
            ruleset.rules.prepareCallableLookupFrame(simpleFrame, segment, includeRulesets);
            const simpleHit = lookupScopeFrameCallable(simpleFrame, segment, {
              includeRulesets,
              searchParents: false
            });
            if (simpleHit.kind === 'hit') {
              resolved = collectCallableBucketResults(simpleHit.bucket, includeRulesets);
              simpleCallableCovered = true;
            } else if (simpleHit.kind === 'miss') {
              simpleCallableCovered = true;
            } else if (simpleHit.reason === 'child-surface' || simpleHit.reason === 'reference-import') {
              const uncovered = ruleset.rules.findMixinsFastForUncoveredCallable(
                segment,
                simpleHit.reason,
                includeRulesets,
                simpleLookupOptions
              );
              if (uncovered !== UNCOVERED_CALLABLE_UNSUPPORTED) {
                resolved = uncovered;
                simpleCallableCovered = true;
              }
            }
          }
          if (resolved === undefined && !simpleCallableCovered) {
            const simpleCallableMatches = ruleset.rules.findMixinsFast(segment, simpleLookupOptions);
            if (simpleCallableMatches.length > 0) {
              resolved = simpleCallableMatches;
            }
          }
          if (resolved === undefined && options.terminalMixinOnly !== true) {
            const simpleCallableRulesets = ruleset.rules.findVisibleExactCallableRulesetPath([segment], {
              hasTarget: options.hasTarget,
              local: options.local,
              searchParents: false,
              context: options.context
            });
            resolved = simpleCallableRulesets.length > 0 ? simpleCallableRulesets : undefined;
          }
        } else {
          nestedOptions ??= {
            ...options,
            searchParents: false
          };
          const rulesetResolved = ruleset.rules.findRulesetNamespacePathFast(
            path,
            nestedOptions,
            remainderStart
          );
          const mixinResolved = ruleset.rules.findMixinNamespacePathFast(
            path,
            undefined,
            nestedOptions,
            remainderStart
          );
          if (rulesetResolved !== undefined && mixinResolved !== undefined) {
            resolved = rulesetResolved.length === 0
              ? mixinResolved
              : mixinResolved.length === 0
                ? rulesetResolved
                : [...rulesetResolved, ...mixinResolved];
          } else {
            resolved = rulesetResolved ?? mixinResolved;
          }
          if (resolved === undefined || resolved.length === 0) {
            resolved = ruleset.rules.findMixin(
              collectKeyRemainder(path, remainderStart),
              undefined,
              nestedOptions
            );
          }
        }
        if (resolved?.length) {
          const guarded = withRulesetNamespaceGuards(resolved, ruleset);
          if (resolvedEntries === undefined) {
            resolvedEntries = guarded;
            resolvedEntriesOwned = guarded !== resolved;
            continue;
          }
          if (!resolvedEntriesOwned) {
            resolvedEntries = [...resolvedEntries];
            resolvedEntriesOwned = true;
          }
          for (let resolvedIndex = 0; resolvedIndex < guarded.length; resolvedIndex++) {
            resolvedEntries.push(guarded[resolvedIndex]!);
          }
        }
      }

      if (resolvedEntries !== undefined && resolvedEntries.length > 0) {
        return resolvedEntries;
      }
      return sawLegacyOnlyPrefix ? undefined : DEFINITE_MISS;
    };

    const result = walk(this, keys, pathStart, true);
    return result === DEFINITE_MISS ? [] : result;
  }

  private findCompoundPrefixCallableRulesetPathFast(
    keys: string[],
    options: CallableFindOptions = {}
  ): CallableRulesetPathResult | undefined {
    if (keys.length < 2) {
      return undefined;
    }

    const prefixMatches = this.findVisibleCallableRulesetPrefixMatches(keys, {
      hasTarget: options.hasTarget,
      local: options.local,
      context: options.context
    });
    if (prefixMatches.length === 0) {
      return { entries: [], owned: true };
    }

    if (prefixMatches.length > 1) {
      prefixMatches.sort((a, b) => b.consumed.length - a.consumed.length);
    }
    let nestedOptions: CallableFindOptions | undefined;
    const existingNoParentOptions = options.searchParents === false ? options : undefined;

    for (const { ruleset, consumed } of prefixMatches) {
      const remainderLength = keys.length - consumed.length;
      if (remainderLength === 0) {
        return {
          entries: options.terminalMixinOnly === true ? [] : [ruleset],
          owned: true
        };
      }
      nestedOptions ??= existingNoParentOptions ?? {
        ...options,
        searchParents: false
      };
      let resolved: MixinEntry[] | undefined;
      if (remainderLength === 1) {
        resolved = ruleset.rules.findMixin(keys[consumed.length]!, undefined, nestedOptions);
      } else {
        resolved = ruleset.rules.findMixinNamespacePathFast(
          keys,
          undefined,
          nestedOptions,
          consumed.length
        );
        if (resolved === undefined || resolved.length === 0) {
          resolved = ruleset.rules.findMixin(
            collectKeyRemainder(keys, consumed.length),
            undefined,
            nestedOptions
          );
        }
      }
      if (resolved?.length) {
        const entries = withRulesetNamespaceGuards(resolved, ruleset);
        return { entries, owned: entries !== resolved };
      }
    }

    return { entries: [], owned: true };
  }

  private findCallableDescendantsWithinMixinNamespaces(
    namespaceMixins: MixinEntry[],
    keys: string[],
    options: CallableFindOptions = {}
  ): MixinEntry[] | undefined {
    if (keys.length < 2 || namespaceMixins.length === 0) {
      return undefined;
    }

    let remainder: string | string[] | undefined;
    let nestedOptions: CallableFindOptions | undefined;
    const existingNoParentOptions = options.searchParents === false ? options : undefined;
    let resolved: MixinEntry[] | undefined;
    let resolvedOwned = false;
    let descendantMissCovered = false;
    for (let i = 0; i < namespaceMixins.length; i++) {
      const entry = namespaceMixins[i]!;
      if (!isCallableEntry(entry)) {
        continue;
      }
      if (!callableEntryHasNoRequiredParams(entry)) {
        continue;
      }
      const firstRemainder = keys[1]!;
      const firstRemainderIncludesRulesets = keys.length === 2 && options.terminalMixinOnly !== true;
      const entryRules = getMixinEntryRules(entry);
      const childFrame = entryRules._scopeFrame ?? (entryRules.evaluated ? entryRules.getScopeFrame() : undefined);
      let nested: MixinEntry[] | undefined;
      if (childFrame && !options.hasTarget && !options.local) {
        entryRules.prepareCallableLookupFrame(childFrame, firstRemainder, firstRemainderIncludesRulesets);
        const firstRemainderHit = lookupScopeFrameCallable(childFrame, firstRemainder, {
          includeRulesets: firstRemainderIncludesRulesets,
          searchParents: false
        });
        if (firstRemainderHit.kind === 'hit' && keys.length === 2) {
          nested = collectCallableBucketResults(firstRemainderHit.bucket, firstRemainderIncludesRulesets);
        } else if (firstRemainderHit.kind === 'miss') {
          if (keys.length === 2 && childFrame.fallbackFrame) {
            let fallbackFrame = childFrame.fallbackFrame;
            let fallbackMissCovered = true;
            while (fallbackFrame) {
              if (isNode(fallbackFrame.rulesNode, N.Rules)) {
                fallbackFrame.rulesNode.prepareCallableLookupFrame(
                  fallbackFrame,
                  firstRemainder,
                  firstRemainderIncludesRulesets
                );
              }
              const fallbackHit = lookupScopeFrameCallable(fallbackFrame, firstRemainder, {
                includeRulesets: firstRemainderIncludesRulesets,
                searchParents: false
              });
              if (fallbackHit.kind === 'hit') {
                nested = collectCallableBucketResults(fallbackHit.bucket, firstRemainderIncludesRulesets);
                break;
              }
              if (fallbackHit.kind === 'uncovered') {
                fallbackMissCovered = false;
                break;
              }
              fallbackFrame = fallbackFrame.fallbackFrame;
            }
            if (nested === undefined && fallbackMissCovered) {
              descendantMissCovered = true;
              continue;
            }
          } else if (!childFrame.fallbackFrame) {
            descendantMissCovered = true;
            continue;
          }
        } else if (
          firstRemainderHit.kind === 'uncovered'
          && keys.length === 2
          && (firstRemainderHit.reason === 'child-surface' || firstRemainderHit.reason === 'reference-import')
        ) {
          const uncovered = entryRules.findMixinsFastForUncoveredCallable(
            firstRemainder,
            firstRemainderHit.reason,
            firstRemainderIncludesRulesets,
            options
          );
          if (uncovered !== UNCOVERED_CALLABLE_UNSUPPORTED) {
            if (uncovered.length === 0) {
              descendantMissCovered = true;
              continue;
            }
            nested = uncovered;
          }
        }
      }
      nestedOptions ??= existingNoParentOptions ?? {
        ...options,
        searchParents: false
      };
      if (nested === undefined && keys.length === 2) {
        remainder ??= keys[1]!;
        nested = entryRules.findMixin(remainder, undefined, nestedOptions);
      } else if (nested === undefined) {
        nested = entryRules.findMixinNamespacePathFast(keys, undefined, nestedOptions, 1);
        if (nested === undefined) {
          remainder ??= collectKeyRemainder(keys, 1);
          nested = entryRules.findMixin(
            remainder,
            undefined,
            nestedOptions
          );
        }
      }
      if (nested?.length) {
        const originalNested = nested;
        nested = withCallableNamespaceGuards(nested, entry);
        if (resolved === undefined) {
          resolved = nested;
          resolvedOwned = nested !== originalNested;
          continue;
        }
        if (!resolvedOwned) {
          resolved = [...resolved];
          resolvedOwned = true;
        }
        for (let nestedIndex = 0; nestedIndex < nested.length; nestedIndex++) {
          resolved.push(nested[nestedIndex]!);
        }
      }
    }

    return resolved
      ? normalizeNamespaceCallableResults(resolved, keys)
      : descendantMissCovered ? [] : undefined;
  }

  findMixin(
    keys: string | string[],
    filterType?: string,
    options: CallableFindOptions = {}
  ): MixinEntry[] | undefined {
    if (typeof keys === 'string') {
      const includeRulesets = filterType !== 'Mixin' && options.terminalMixinOnly !== true;
      const callableFrame = this._scopeFrame;
      if (callableFrame && !options.hasTarget && !options.local) {
        this.prepareCallableLookupFrame(callableFrame, keys, includeRulesets);
        const frameHit = lookupScopeFrameCallable(callableFrame, keys, {
          includeRulesets,
          searchParents: false
        });
        let frameMissCovered = false;
        if (frameHit.kind === 'hit') {
          const results = collectCallableBucketResults(frameHit.bucket, includeRulesets);
          if (results) {
            return results;
          }
        }
        if (
          frameHit.kind === 'uncovered'
          && (frameHit.reason === 'child-surface' || frameHit.reason === 'reference-import')
        ) {
          const direct = this.findMixinsFastForUncoveredCallable(
            keys,
            frameHit.reason,
            includeRulesets,
            options
          );
          if (direct !== UNCOVERED_CALLABLE_UNSUPPORTED) {
            frameMissCovered = true;
            if (direct.length > 0) {
              return direct;
            }
          }
        }
        if (frameHit.kind === 'uncovered' && frameHit.reason === 'candidate') {
          frameMissCovered = true;
        }
        if (
          options.searchParents === false
          && (frameHit.kind === 'miss' || frameHit.kind === 'uncovered')
        ) {
          const pathKeys = splitStaticCallablePathKey(keys);
          if (pathKeys) {
            return this.findMixin(pathKeys, filterType, options);
          }
          return undefined;
        }
        if (frameHit.kind === 'miss' || frameHit.kind === 'uncovered') {
          let retryFrame = callableFrame.parent;
          let fallbackFrame = callableFrame.fallbackFrame;
          while (retryFrame) {
            let retryHit = lookupScopeFrameCallable(retryFrame, keys, {
              includeRulesets,
              searchParents: false
            });
            if (retryHit.kind === 'uncovered' && (retryHit.reason === 'frame' || retryHit.reason === 'key')) {
              if (isNode(retryFrame.rulesNode, N.Rules)) {
                this.prepareCallableLookupFrame(retryFrame, keys, includeRulesets);
                retryHit = lookupScopeFrameCallable(retryFrame, keys, {
                  includeRulesets,
                  searchParents: false
                });
              }
            }
            if (retryHit.kind === 'hit') {
              const results = collectCallableBucketResults(retryHit.bucket, includeRulesets);
              if (results) {
                return results;
              }
            }
            if (
              retryHit.kind === 'uncovered'
              && (retryHit.reason === 'child-surface' || retryHit.reason === 'reference-import')
            ) {
              if (isNode(retryFrame.rulesNode, N.Rules)) {
                const direct = retryFrame.rulesNode.findMixinsFastForUncoveredCallable(
                  keys,
                  retryHit.reason,
                  includeRulesets,
                  options
                );
                if (direct !== UNCOVERED_CALLABLE_UNSUPPORTED) {
                  frameMissCovered = true;
                  if (direct.length > 0) {
                    return direct;
                  }
                }
              }
            }
            retryFrame = retryFrame.parent;
            if (!retryFrame && fallbackFrame) {
              retryFrame = fallbackFrame;
              fallbackFrame = fallbackFrame.fallbackFrame;
            }
          }
          if (frameHit.kind === 'miss') {
            const pathKeys = splitStaticCallablePathKey(keys);
            if (pathKeys) {
              return this.findMixin(pathKeys, filterType, options);
            }
            return undefined;
          }
          if (frameMissCovered) {
            const pathKeys = splitStaticCallablePathKey(keys);
            if (pathKeys) {
              return this.findMixin(pathKeys, filterType, options);
            }
            return undefined;
          }
        }
      }
      const pathKeys = splitStaticCallablePathKey(keys);
      if (pathKeys) {
        return this.findMixin(pathKeys, filterType, options);
      }
      const direct = this.findMixinsFast(keys, {
        hasTarget: options.hasTarget,
        local: options.local,
        includeRulesets,
        searchParents: options.searchParents
      });
      return direct.length > 0 ? direct : undefined;
    } else if (isArray(keys) && keys.length === 0) {
      return undefined;
    } else if (isArray(keys) && keys.length === 1) {
      return this.findMixin(keys[0]!, filterType, options);
    } else if (isArray(keys) && keys.length > 1) {
      const mixinFilterType = filterType === 'Mixin' ? 'Mixin' : undefined;
      let compoundPrefixFast: CallableRulesetPathResult | undefined;
      let rulesetNamespaceFast: MixinEntry[] | undefined;
      let mixinNamespaceFast: MixinEntry[] | undefined;
      if (mixinFilterType !== 'Mixin') {
        rulesetNamespaceFast = this.findRulesetNamespacePathFast(keys, options);
        let namespaceMixins: MixinEntry[] | undefined;
        let namespaceMixinMissCovered = false;
        if (this._scopeFrame && !options.hasTarget && !options.local) {
          const namespaceKey = keys[0]!;
          this.prepareCallableLookupFrame(this._scopeFrame, namespaceKey, false);
          const frameHit = lookupScopeFrameCallable(this._scopeFrame, namespaceKey, {
            includeRulesets: false
          });
          if (frameHit.kind === 'hit') {
            namespaceMixins = collectCallableBucketResults(frameHit.bucket, false) ?? [];
          } else if (frameHit.kind === 'miss') {
            namespaceMixinMissCovered = true;
          } else if (
            frameHit.reason === 'child-surface'
            || frameHit.reason === 'reference-import'
            || (frameHit.reason === 'key' && this._scopeFrame.hasReferenceImports)
          ) {
            if (rulesetNamespaceFast !== undefined) {
              namespaceMixinMissCovered = true;
            } else {
              const reason = frameHit.reason === 'key' ? 'reference-import' : frameHit.reason;
              const uncovered = this.findMixinsFastForUncoveredCallable(
                namespaceKey,
                reason,
                false,
                options
              );
              if (uncovered !== UNCOVERED_CALLABLE_UNSUPPORTED) {
                namespaceMixins = uncovered;
                namespaceMixinMissCovered = true;
              }
            }
          }
        }
        if (
          namespaceMixins === undefined
          && !namespaceMixinMissCovered
          && rulesetNamespaceFast === undefined
        ) {
          namespaceMixins = this.findMixinsFast(keys[0]!, {
            hasTarget: options.hasTarget,
            local: options.local,
            includeRulesets: false
          });
        }
        if (
          (!namespaceMixins || namespaceMixins.length === 0)
          && (rulesetNamespaceFast === undefined || rulesetNamespaceFast.length === 0)
        ) {
          if (options.terminalMixinOnly !== true) {
            const exactRulesetPath = this.findVisibleExactCallableRulesetPath(keys, {
              hasTarget: options.hasTarget,
              local: options.local,
              context: options.context
            });
            if (exactRulesetPath.length > 0) {
              return exactRulesetPath;
            }
            const namespaceRulesets = this.findVisibleExactCallableRulesetPath([keys[0]!], {
              hasTarget: options.hasTarget,
              local: options.local,
              context: options.context
            });
            if (namespaceRulesets.length !== 0) {
              return undefined;
            }
          }
          return undefined;
        }
        if (rulesetNamespaceFast === undefined || rulesetNamespaceFast.length === 0) {
          compoundPrefixFast = this.findCompoundPrefixCallableRulesetPathFast(keys, options);
        }
        mixinNamespaceFast = namespaceMixins && namespaceMixins.length > 0
          ? this.findCallableDescendantsWithinMixinNamespaces(
              namespaceMixins,
              keys,
              options
            )
          : undefined;
      }
      let fast = mixinNamespaceFast ?? (
        rulesetNamespaceFast !== undefined
        && (rulesetNamespaceFast.length > 0 || options.terminalMixinOnly === true)
          ? undefined
          : this.findMixinNamespacePathFast(keys, mixinFilterType, options)
      );
      if (rulesetNamespaceFast !== undefined) {
        if (rulesetNamespaceFast.length === 0) {
          if (fast === undefined) {
            return undefined;
          }
        } else if (fast === undefined || fast.length === 0) {
          fast = rulesetNamespaceFast;
        } else {
          let union = fast;
          let unionOwned = false;
          for (let i = 0; i < rulesetNamespaceFast.length; i++) {
            const node = rulesetNamespaceFast[i]!;
            let found = false;
            for (let existing = 0; existing < union.length; existing++) {
              if (union[existing] === node) {
                found = true;
                break;
              }
            }
            if (!found) {
              if (!unionOwned) {
                union = [...union];
                unionOwned = true;
              }
              union.push(node);
            }
          }
          fast = union;
        }
      }
      if (compoundPrefixFast !== undefined && compoundPrefixFast.entries.length > 0) {
        let compoundUnion = compoundPrefixFast.entries;
        let compoundUnionOwned = compoundPrefixFast.owned;
        if (fast !== undefined && fast.length > 0) {
          for (let i = 0; i < fast.length; i++) {
            const node = fast[i]!;
            let found = false;
            for (let existing = 0; existing < compoundUnion.length; existing++) {
              if (compoundUnion[existing] === node) {
                found = true;
                break;
              }
            }
            if (!found) {
              if (!compoundUnionOwned) {
                compoundUnion = [...compoundUnion];
                compoundUnionOwned = true;
              }
              compoundUnion.push(node);
            }
          }
        }
        return normalizeCompoundPrefixCallableResults(compoundUnion);
      }
      if (fast !== undefined) {
        return fast.length > 0 ? normalizeNamespaceCallableResults(fast, keys) : undefined;
      }
      return undefined;
    }
    return undefined;
  }

  findFunction(
    keys: string,
    filterType?: string,
    options?: CallableFindOptions
  ): JsFunction | Func | undefined {
    void filterType;
    let rules: Rules | undefined = this;
    const { searchParents = true } = options ?? {};
    let findRoot = false;
    const seen = new Set<Rules>();
    while (rules) {
      if (seen.has(rules)) {
        return undefined;
      }
      seen.add(rules);
      const fn = rules.functionsByName?.get(keys);
      if (fn || !searchParents) {
        return fn;
      }

      do {
        let parent: Node | undefined = rules.sourceParent;
        let frameParent = rules._scopeFrame?.parent ?? rules._scopeFrame?.fallbackFrame;
        rules = undefined;
        while (parent) {
          if (isNode(parent, N.Rules)) {
            rules = parent;
            break;
          }
          parent = parent.sourceParent;
        }
        while (!rules && frameParent) {
          if (isNode(frameParent.rulesNode, N.Rules)) {
            rules = frameParent.rulesNode;
            break;
          }
          frameParent = frameParent.parent ?? frameParent.fallbackFrame;
        }
        const rulesParent = rules?.sourceParent;
        if (findRoot && rules?.type === 'Rules' && rulesParent === undefined) {
          break;
        }
        if (isNonClassicImportBoundary(rules)) {
          findRoot = true;
        }
      } while (!findRoot && rules && rules.type !== 'Rules');
    }
    return undefined;
  }

  override toString(options?: PrintOptions): string {
    if (!this.visible && !this.fullRender) {
      return '';
    }
    return this._toDocumentString(options);
  }

  _toDocumentString(options?: PrintOptions): string {
    if (!this.visible && !this.fullRender) {
      return '';
    }
    options = getPrintOptions(options);
    const w = options.writer!;
    const depth = options.depth!;
    const mark = w.mark();

    const ctx = options.context;
    const suppressedLeadingComments: Array<{ node: Node; visible: boolean }> = [];
    const saved = savePrintState(options, ['referenceMode', 'referenceRenderEnabled']);
    const ownReferenceMode = (this.options as { referenceMode?: boolean } | undefined)?.referenceMode === true;
    if (ownReferenceMode && options.referenceMode !== true) {
      options.referenceMode = true;
      options.referenceRenderEnabled = false;
    }
    if (depth === 0) {
    // Snapshot global emit-tracking so repeated `.toString()` calls remain stable.
      const prevCharsetEmitted = ctx?.charsetEmitted;
      // @charset must be first
      if (ctx?.currentCharset && !ctx.charsetEmitted) {
        const charset = ctx.currentCharset;
        charset.writeSyntax(options);
        w.add('\n');
        // Do not permanently flip `charsetEmitted` here; restore at end.
        ctx.charsetEmitted = true;
      }
      if (ctx?.topImports?.length) {
        for (const node of this.rules) {
          const leadingTrivia = consumeLeadingTrivia(node, options);
          if (leadingTrivia.trim()) {
            w.add(normalizeIndent(leadingTrivia, ''), node);
            break;
          }
          if (node.hasFlag(F_VISIBLE)) {
            break;
          }
        }
      }
      // Less keeps leading comments before hoisted @import output.
      const isCommentLike = (node: Node): boolean => {
        return isNode(node, N.Comment) && node.visible;
      };
      if (ctx?.topImports?.length) {
        for (const node of this.rules) {
          if (!isCommentLike(node)) {
            break;
          }
          const commentStr = writeDetached(options, nextOptions => node.writeSyntax(nextOptions));
          w.add(normalizeIndent(commentStr, ''), node);
          w.add('\n');
          const wasVisible = node.hasFlag(F_VISIBLE);
          suppressedLeadingComments.push({ node, visible: wasVisible });
          if (wasVisible) {
            node.removeFlag(F_VISIBLE);
          }
        }
      }
      // @import must come after @charset but before other rules
      if (ctx?.topImports?.length) {
        for (const importRule of ctx.topImports) {
          if (isNode(importRule, N.AtRule)) {
            const importPrelude = importRule.prelude;
            if (importPrelude && String(importPrelude.valueOf?.() ?? '').includes('$')) {
              const maybePrelude = importPrelude.eval(ctx);
              if (!isThenable(maybePrelude)) {
                importRule.prelude = maybePrelude as Node;
                importRule.adopt(importRule.prelude);
              }
            }
          }
          const importStr = writeDetached(options, nextOptions => importRule.writeSyntax(nextOptions));
          w.add(normalizeIndent(importStr, ''), importRule);
          w.add('\n');
        }
      // Do not permanently clear; restore at end.
      }
      // Restore global tracking (we only needed it during this print).
      if (ctx) {
        ctx.charsetEmitted = prevCharsetEmitted;
      }
    }

    this._emitRulesBody(options, 'source');
    if (depth === 0) {
      const eofTrivia = consumeEofTrivia(this, options);
      if (eofTrivia.trim()) {
        if (w.hasContentSince(mark) && !w.endsWith('\n')) {
          w.add('\n');
        }
        w.add(/\/\*/u.test(eofTrivia) ? normalizeBlockTrivia(eofTrivia, '') : normalizeIndent(eofTrivia, ''));
      }
    }
    let result: string;
    // At root level, ensure output ends with a single newline (standard for CSS files)
    // Don't propagate all the last child's post content (which may have extra whitespace)
    if (depth === 0) {
      for (const suppressed of suppressedLeadingComments) {
        if (suppressed.visible) {
          suppressed.node.addFlag(F_VISIBLE);
        }
      }
      result = w.getSince(mark).trimEnd();
      // Ensure exactly one trailing newline (only if there's content)
      result = result ? result + '\n' : '';
    } else {
      result = w.getSince(mark);
    }
    restorePrintState(options, saved);
    return result;
  }

  pendingExtends = new Set<[find: Selector, extendWith: Selector, partial: boolean]>();

  constructor(
    value: Node[],
    options?: RulesOptions & NodeOptions,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    let rulesVisibility = options?.rulesVisibility ?? {};
    // Set defaults for API-created Rules. Parsers will override these as needed:
    // - Less mixins/rulesets: VarDeclaration = 'optional', Mixin = 'public'
    // - Sass mixins/rulesets: VarDeclaration = 'private', Mixin = 'private'
    // - Imports: VarDeclaration = 'public', Mixin = 'public'
    // Default to 'public' for API-created Rules (better DX - variables are accessible).
    // If you want nested Rules to be private, set it explicitly.
    rulesVisibility.Declaration ??= 'public';
    rulesVisibility.Ruleset ??= 'public';
    rulesVisibility.VarDeclaration ??= 'public';
    rulesVisibility.Mixin ??= 'public';
    // Merge with existing options to preserve rulesVisibility
    const mergedOptions = { ...options, rulesVisibility };
    const rules = value ?? [];
    super(rules, mergedOptions, location, false);
    this.rules = rules;
    this._sourceRoot = this;
    this._treeContext = treeContext;
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (rule instanceof Node) {
        this.adopt(rule);
      }
    }
  }

  /**
   * Used by Ruleset, Mixins, and AtRules etc to render
   * rules with braces.
   */
  toBraced(options?: PrintOptions) {
    let opts = getPrintOptions(options);
    const w = opts.writer!;
    const mark = w.mark();
    this.writeBraced(opts);
    return w.getSince(mark);
  }

  writeBraced(options: FinalPrintOptions): void {
    // Use options.depth if provided, otherwise calculate from frameState
    const depth = options.depth!;
    const w = options.writer!;
    let space = ''.padStart(depth * 2);
    w.add('{');
    w.add('\n');
    const saved = savePrintState(options, ['depth']);
    options.depth = depth + 1;
    this._emitSourceRulesBody(options);
    restorePrintState(options, saved);
    // ensure closing brace is on its own properly indented line
    w.add('\n');
    if (depth !== 0) {
      w.add(space);
    }
    w.add('}');
    // At root level (depth === 0), don't add a newline after the closing brace
    // The parent _emitRulesBody will add the newline before the next item
    // For nested rules (depth > 0), the newline is handled by the parent's _emitRulesBody
  }

  private _emitSourceRulesBody(options: PrintOptions): void {
    this._emitRulesBody(options, 'source');
  }

  private _emitRenderRulesBody(options: PrintOptions): MaybePromise<void> {
    return this._emitRulesBody(options, 'render');
  }

  private _emitRulesBody(options: PrintOptions, mode: 'source'): void;
  private _emitRulesBody(options: PrintOptions, mode: 'render'): MaybePromise<void>;
  private _emitRulesBody(options: PrintOptions, mode: 'source' | 'render'): MaybePromise<void> {
    const w = options.writer!;
    const context = options.context;
    const depth = options.depth ?? 0;
    const space = indent(depth);
    const { value } = this;
    const lastRenderedFrames = options.lastRenderedFrames!;
    const frameHeaders = options.frameHeaders!;
    const renderedFrameBaseline = lastRenderedFrames.length;
    // Propagate this Rules wrapper's own `referenceMode` into the active render state
    // before emitting children. Without this, import wrappers (shallow-cloned
    // from a shared evaluated tree) can't hide their content via reference
    // mode — the flag lives on the wrapper's options but never reaches
    // downstream serialize-helper checks for descendants pulled up by
    // `flatRules` (which strips the nested Rules boundary).
    const referenceMode = Boolean(options.referenceMode);
    const referenceRenderEnabled = referenceMode ? Boolean(options.referenceRenderEnabled) : true;

    if (!this.hasVisibleRules()) {
      return;
    }

    const isInlineSourceRules = (node: Node): boolean => {
      if (!isNode(node, N.Rules)) {
        return false;
      }
      if (node.rules.length !== 1) {
        return false;
      }
      const only = node.rules[0]!;
      return isNode(only, N.Any) && only.role === 'any';
    };
    const isBlockContainer = (node: Node): node is Ruleset | AtRule => {
      return isNode(node, N.Ruleset) || (isNode(node, N.AtRule) && Boolean(node.rules));
    };

    let emittedCount = 0;
    let lastEmittedType: string | undefined;
    let lastEmittedWasInlineSourceRules = false;
    const emitBoundaryIfNeeded = (n: Node) => {
      if (emittedCount === 0) {
        return;
      }
      const needsInlineBoundarySpacing = (
        (lastEmittedType === 'Any' && n.type !== 'Any')
        || (lastEmittedWasInlineSourceRules && n.type !== 'Any')
      );
      if (!w.endsWith('\n') || needsInlineBoundarySpacing) {
        w.addSpacer('\n');
      }
    };
    const closeRenderedFramesToBaseline = () => {
      while (lastRenderedFrames.length > renderedFrameBaseline) {
        const depthToClose = lastRenderedFrames.length - 1;
        w.add(indent(depthToClose) + '}\n');
        lastRenderedFrames.pop();
        frameHeaders.pop();
      }
    };
    const markEmitted = (n: Node) => {
      emittedCount++;
      lastEmittedType = n.type;
      lastEmittedWasInlineSourceRules = isInlineSourceRules(n);
    };
    const emitCaptured = (text: string, n: Node, prefix?: string) => {
      emitBoundaryIfNeeded(n);
      if (prefix) {
        w.addSpacer(prefix);
      }
      w.add(text, n);
      if (n.requiredSemi && n.options.semi !== false) {
        w.add(';', n);
      }
      markEmitted(n);
    };
    const emitLeadingBlockCommentForNode = (n: Node): boolean => {
      if (!hasPrintableTriviaAt(n, 'before', options)) {
        return false;
      }
      const leading = consumeLeadingTrivia(n, options);
      if (!/\/\*/.test(leading)) {
        return false;
      }
      closeRenderedFramesToBaseline();
      emitBoundaryIfNeeded(n);
      const commentIndent = depth === 0 ? '' : space;
      const normalized = (
        depth === 0
          ? normalizeBlockTrivia(leading, '')
          : normalizeIndent(leading, commentIndent, true)
      ).replace(/[ \t]+$/u, '');
      w.add(normalized, n);
      if (!/\n$/.test(normalized)) {
        w.add('\n');
      }
      markEmitted(n);
      return true;
    };
    const saved = savePrintState(options, ['referenceMode']);
    if (
      (this.options as { referenceMode?: boolean } | undefined)?.referenceMode === true
      && options.referenceMode !== true
    ) {
      options.referenceMode = true;
    }
    const emitNode = (n: Node): MaybePromise<void> => {
      if (isHiddenMixinOutputChild(this, n)) {
        return;
      }
      const isEvaluatedDefinitionNode = (this.evaluated || mode === 'render') && isNode(n, N.Mixin | N.VarDeclaration);
      if (
        isEvaluatedDefinitionNode
        && !hasPrintableTriviaAt(n, 'before', options)
        && !hasPrintableTriviaAt(n, 'after', options)
      ) {
        return;
      }
      if (!n.visible && !n.fullRender) {
        emitLeadingBlockCommentForNode(n);
        return;
      }
      const isChildRules = isNode(n, N.Rules);
      const isRulesetOrAtRule = isBlockContainer(n);
      const isContainer = isChildRules || isRulesetOrAtRule;
      if (isContainer && n.type === 'Rules') {
        emitLeadingBlockCommentForNode(n);
      }
      if (referenceMode && !referenceRenderEnabled && !isContainer) {
        return;
      }
      // Add indentation only for simple nodes (declarations, etc.)
      // Ruleset and AtRule nodes indent themselves in renderOpening
      // Emit directly to preserve source map segments
      // For child Rules nodes, pass the same depth (don't increment depth)
      // Rules nodes inside Rules nodes are at the same level
      if (isChildRules) {
        let hasRenderableChild = false;
        for (let i = 0; i < n.rules.length; i++) {
          const child = n.rules[i]!;
          if (
            child.visible
            || child.fullRender
            || hasPrintableTriviaAt(child, 'before', options)
            || hasPrintableTriviaAt(child, 'after', options)
          ) {
            hasRenderableChild = true;
            break;
          }
        }
        if (
          !hasRenderableChild
          && !hasPrintableTriviaAt(n, 'before', options)
          && !hasPrintableTriviaAt(n, 'after', options)
        ) {
          return;
        }
        const ownReferenceMode = n.options.referenceMode === true;
        const childReferenceMode = referenceMode || ownReferenceMode;
        const enteringReferenceMode = !referenceMode && ownReferenceMode;
        const childReferenceRenderEnabled = childReferenceMode
          ? (enteringReferenceMode ? false : referenceRenderEnabled)
          : true;
        closeRenderedFramesToBaseline();
        const childSaved = savePrintState(options, ['depth', 'referenceMode', 'referenceRenderEnabled']);
        const childEmittedTrivia = options.emittedTrivia;
        const childPosition = w.position();
        options.depth = depth;
        options.referenceMode = childReferenceMode;
        options.referenceRenderEnabled = childReferenceRenderEnabled;
        emitBoundaryIfNeeded(n);
        const childRule = mode === 'render' && context
          ? n._emitRenderRulesBody(options)
          : n._emitSourceRulesBody(options);
        const finishChildRule = (): void => {
          options.emittedTrivia = childEmittedTrivia;
          restorePrintState(options, childSaved);
          if (w.position() === childPosition) {
            return;
          }
          markEmitted(n);
        };
        return isThenable(childRule)
          ? childRule.then(finishChildRule)
          : finishChildRule(childRule);
      }
      if (isRulesetOrAtRule) {
        emitLeadingBlockCommentForNode(n);
        emitBoundaryIfNeeded(n);
        const position = w.position();
        const containerSaved = savePrintState(options, ['depth', 'referenceMode', 'referenceRenderEnabled']);
        options.depth = depth;
        options.referenceMode = referenceMode;
        options.referenceRenderEnabled = referenceRenderEnabled;
        const rule = mode === 'render' && context
          ? n.render(context, getPrintOptions(options))
          : serializeRulesContainerInline(n, getPrintOptions(options));
        const finishRule = (resolvedRule: string): void => {
          if (w.position() === position && resolvedRule) {
            w.add(resolvedRule, n);
          }
          restorePrintState(options, containerSaved);
          if (w.position() === position) {
            return;
          }
          markEmitted(n);
        };
        return isThenable(rule)
          ? rule.then(finishRule)
          : finishRule(rule);
      }
      closeRenderedFramesToBaseline();
      const leafSaved = savePrintState(options, ['depth', 'referenceMode', 'referenceRenderEnabled']);
      const leafMark = w.mark();
      const prefix = depth !== 0 ? space : undefined;
      emitBoundaryIfNeeded(n);
      if (prefix) {
        w.addSpacer(prefix);
      }
      options.depth = depth;
      options.referenceMode = referenceMode;
      options.referenceRenderEnabled = referenceRenderEnabled;
      w.markSource(n);
      if (mode === 'source') {
        n.writeSyntax(options);
        restorePrintState(options, leafSaved);
        if (!w.hasContentSince(leafMark)) {
          w.restore(leafMark);
          return;
        }
        if (n.requiredSemi && n.options.semi !== false) {
          w.add(';', n);
        }
        markEmitted(n);
        return;
      }
      const output = n.render(context, options);
      const finishOutput = (resolvedOutput: string): void => {
        restorePrintState(options, leafSaved);
        if (!w.hasContentSince(leafMark)) {
          w.restore(leafMark);
          if (resolvedOutput) {
            emitCaptured(resolvedOutput, n, prefix);
          }
          return;
        }
        if (n.requiredSemi && n.options.semi !== false) {
          w.add(';', n);
        }
        markEmitted(n);
      };
      return isThenable(output)
        ? output.then(finishOutput)
        : finishOutput(output);
    };
    const finish = (): void => {
      while (lastRenderedFrames.length > renderedFrameBaseline) {
        const depthToClose = lastRenderedFrames.length - 1;
        w.add(indent(depthToClose) + '}\n');
        lastRenderedFrames.pop();
        frameHeaders.pop();
      }
      restorePrintState(options, saved);
    };
    if (mode === 'render') {
      const emitRest = (start: number): MaybePromise<void> => {
        for (let i = start; i < value.length; i++) {
          const result = emitNode(value[i]!);
          if (isThenable(result)) {
            return result.then(() => emitRest(i + 1));
          }
        }
        return finish();
      };
      return emitRest(0);
    }
    for (const n of value) {
      void emitNode(n);
    }
    finish();
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const position = w.position();
    this.writeSyntax(options);
    return getWriterTextSincePosition(w, position);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    if (!this.visible && !this.fullRender) {
      return;
    }
    this._emitSourceRulesBody(options);
  }

  toRenderString(options?: PrintOptions): MaybePromise<string> {
    if (!this.visible && !this.fullRender) {
      return '';
    }
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const rendered = this._emitRenderRulesBody(options);
    return isThenable(rendered)
      ? rendered.then(() => w.getSince(mark))
      : w.getSince(mark);
  }

  private evalForRender(context: Context, sourceWasRoot: boolean): MaybePromise<RulesRenderState> {
    if (this.evaluated || canRenderStaticRulesDirectly(this)) {
      this.coalesceGeneratedControlOutput();
      return createRulesRenderState(this, this, sourceWasRoot);
    }
    if (this.registrationPrepared) {
      const output = this.eval(context);
      const toState = (rules: Rules): RulesRenderState => createRulesRenderState(this, rules, sourceWasRoot);
      return isThenable(output)
        ? output.then(toState)
        : toState(output);
    }
    if (sourceWasRoot && (context.currentCharset || context.topImports?.length)) {
      return createRulesRenderState(this, this, sourceWasRoot);
    }
    if (sourceWasRoot) {
      const saved = this._snapshotContext(context);
      const output = this.eval(context);
      const toState = (rules: Rules): RulesRenderState => createRulesRenderState(
        this,
        rules,
        sourceWasRoot,
        undefined,
        saved
      );
      return isThenable(output)
        ? output.then(toState)
        : toState(output);
    }
    // Direct render on an unevaluated Rules node is a compatibility/debug API.
    // Public compiler render APIs evaluate the root before serialization.
    const saved = this._snapshotContext(context);
    this._setupContextForRules(context, this);
    return createRulesRenderState(this, this, sourceWasRoot, saved);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const sourceWasRoot = this === context.root || (context.root === undefined && context.rulesContext === undefined);
    const value = this.evalForRender(context, sourceWasRoot);
    if (isRenderBuffer(bufferOrOptions)) {
      return isThenable(value)
        ? value.then(state => writeRulesStateRenderOutput(bufferOrOptions, state, context, options))
        : writeRulesStateRenderOutput(bufferOrOptions, value, context, options);
    }
    return isThenable(value)
      ? value.then(state => renderRulesStateToString(state, context, bufferOrOptions))
      : renderRulesStateToString(value, context, bufferOrOptions);
  }

  /** All rules, with nested rules flattened */
  flatRules(visibleOnly: boolean = false) {
    const finalRules: Node[] = [];
    const iterateRules = (rules: Rules) => {
      for (let n of rules.rules) {
        if (isNode(n, N.Rules)) {
          iterateRules(n);
          continue;
        }
        if (!visibleOnly || n.visible || n.fullRender) {
          finalRules.push(n);
        }
      }
    };
    iterateRules(this);
    return finalRules;
  }

  visibleRules() {
    const out: Node[] = [];
    for (let i = 0; i < this.rules.length; i++) {
      const node = this.rules[i]!;
      if (node.visible) {
        out.push(node);
      }
    }
    return out;
  }

  hasVisibleRules(): boolean {
    for (let i = 0; i < this.rules.length; i++) {
      if (this.rules[i]!.visible) {
        return true;
      }
    }
    return false;
  }

  /**
   * Return an object representation of a ruleset
   */
  toObject(convertToPrimitives: true): Record<string, string | number | boolean>;
  toObject(convertToPrimitives: false): Record<string, Node>;
  toObject(convertToPrimitives?: boolean): Record<string, string | number  | boolean | Node>;
  toObject(convertToPrimitives: boolean = true): Record<string, string | number | boolean | Node> {
    let output = new Map<string, boolean | string | number | Node>();
    const iterateRules = (rules: Rules) => {
      for (let n of rules.rules) {
        if (isNode(n, N.Declaration)) {
          let { value } = n.value;
          let { important } = n;
          let { name } = n;
          if (convertToPrimitives) {
            let primitive = value.valueOf();
            let outputValue = important ? `${primitive} ${important}` : primitive;
            if (outputValue === undefined) {
              continue;
            }
            output.set(name.toString(), outputValue);
          } else {
            let outputValue = important ? new Sequence([n, important]) : n;
            output.set(name.toString(), outputValue);
          }
        } else if (n instanceof Rules) {
          iterateRules(n);
        }
      }
    };
    iterateRules(this);
    return Object.fromEntries(output);
  }

  registerNode(node: Node, options?: Record<string, any>, context?: Context) {
    this.lookupVersion++;
    let directDeclarationInvalidationKey: string | undefined;
    let directDeclarationInvalidationKeys: Set<string> | undefined;
    let directDeclarationInvalidationIsGlobal = false;
    let directDeclarationGlobalVersionBumped = false;
    if (isNode(node, N.Declaration)) {
      if (this._hasStaticName(node)) {
        directDeclarationInvalidationKey = String(node.name.valueOf());
        this.bumpDeclarationLookupVersion(directDeclarationInvalidationKey);
      } else {
        directDeclarationInvalidationIsGlobal = true;
        this.bumpDeclarationLookupVersion();
        directDeclarationGlobalVersionBumped = true;
      }
    } else if (isNode(node, N.VarDeclaration)) {
      if (this._hasStaticName(node)) {
        directDeclarationInvalidationKey = String(node.name.valueOf());
        this.bumpDeclarationLookupVersion(directDeclarationInvalidationKey);
      } else {
        directDeclarationInvalidationIsGlobal = true;
        this.bumpDeclarationLookupVersion();
        directDeclarationGlobalVersionBumped = true;
      }
    }
    const directChildRules = childCallableRulesOf(node);
    const isCallableLookupNode = isNode(node, N.Mixin)
      || isNode(node, N.Ruleset)
      || isNode(node, N.Rules);
    const affectsCallableLookup = (
      isCallableLookupNode
      || Boolean(directChildRules && !isNode(node, N.Rules))
      || isStyleImportRegistrationNode(node)
    );
    const rebuildCallableCache = affectsCallableLookup && (this.callableLookupCache !== undefined || this._scopeFrame !== undefined);
    if (affectsCallableLookup) {
      this.callableLookupVersion++;
      this.callableLookupCache = undefined;
      this.invalidateExactCallableSurfaceSummaries();
      if (this._scopeFrame) {
        this._scopeFrame.callableBucketsByName = undefined;
        this._scopeFrame.callablesCovered = false;
        this._scopeFrame.callableMissesCovered = false;
        this._scopeFrame.callableMissCoverageKnown = false;
        this._scopeFrame.mixinCallableMissesCovered = false;
        this._scopeFrame.mixinCallableMissCoverageKnown = false;
      }
    }
    if (directChildRules && !isNode(node, N.Rules)) {
      this.addDirectChildRuleEntry(directChildRules);
    }
    const declarationChildRules = childRulesOf(node);
    if (declarationChildRules) {
      this.invalidateReferenceImportSurfaceSummary();
      const keys = directDeclarationInvalidationKeys ??= new Set<string>();
      if (!this.collectStaticDeclarationInvalidationKeys(declarationChildRules, keys)) {
        directDeclarationInvalidationIsGlobal = true;
      }
    }
    if (isStyleImportRegistrationNode(node)) {
      directDeclarationInvalidationIsGlobal = true;
    }
    if (directDeclarationInvalidationIsGlobal) {
      if (!directDeclarationGlobalVersionBumped) {
        this.bumpDeclarationLookupVersion();
      }
      this.invalidateDirectDeclarationLookup();
    } else if (directDeclarationInvalidationKey !== undefined) {
      this.invalidateDirectDeclarationLookup(directDeclarationInvalidationKey);
      if (directDeclarationInvalidationKeys !== undefined) {
        directDeclarationInvalidationKeys.delete(directDeclarationInvalidationKey);
        this.addDirectDeclarationInvalidationKeys(directDeclarationInvalidationKeys);
      }
    } else if (directDeclarationInvalidationKeys !== undefined) {
      this.addDirectDeclarationInvalidationKeys(directDeclarationInvalidationKeys);
    }
    if (declarationChildRules && !isNode(node, N.Rules)) {
      this.addDirectDeclarationChildRuleEntry(declarationChildRules);
    }
    if (node.type === 'Extend' || node.type === 'ExtendList') {
      this._hasExtends = true;
    }
    if (node.type === 'StyleImport') {
      this.invalidateReferenceImportSurfaceSummary();
      const importOptions = 'importOptions' in node.options
        ? node.options.importOptions
        : undefined;
      if (importOptions?.reference === true || importOptions?._dedupe === true) {
        this._hasReferenceImports = true;
        if (this._scopeFrame) {
          this._scopeFrame.hasReferenceImports = true;
          this._scopeFrame.callableMissesCovered = false;
          this._scopeFrame.callableMissCoverageKnown = false;
          this._scopeFrame.mixinCallableMissesCovered = false;
          this._scopeFrame.mixinCallableMissCoverageKnown = false;
        }
      }
    }
    if (isNode(node, N.Rules)) {
      // Use options if provided, otherwise use node's settings, otherwise empty
      // Then merge with node's settings to preserve any values not in options
      let optionsVisibility = options?.rulesVisibility;
      let nodeVisibility = node.options.rulesVisibility ?? {};
      let rulesVisibility = optionsVisibility
        ? { ...nodeVisibility, ...optionsVisibility }
        : nodeVisibility;

      /** Only Declaration and Ruleset are public by default.
       * VarDeclaration visibility should be set by the parser (optional for Less, private for Jess/Sass).
       * Mixin visibility should be set by the parser.
       */
      rulesVisibility.Declaration ??= 'public';
      rulesVisibility.Ruleset ??= 'public';
      rulesVisibility.Mixin ??= 'public';

      /** Either one set as readonly will win */
      let readonly = Boolean(options?.readonly || node.options.readonly);
      this.addDirectDeclarationChildRuleEntry(node, rulesVisibility, readonly);
      this.addDirectChildRuleEntry(node, rulesVisibility, readonly);
      if (this._scopeFrame) {
        this._scopeFrame.callableMissesCovered = false;
        this._scopeFrame.callableMissCoverageKnown = false;
        this._scopeFrame.mixinCallableMissesCovered = false;
        this._scopeFrame.mixinCallableMissCoverageKnown = false;
      }
      if (rulesMayContainExtends(node)) {
        this._hasExtends = true;
      }
      if (rulesHasCarriedReferenceImportSurface(node) || rulesMayContainReferenceImports(node)) {
        this._hasReferenceImports = true;
        this.hasReferenceImportChildSurface = true;
        if (this._scopeFrame) {
          this._scopeFrame.hasReferenceImports = true;
        }
      }

      // Note: Imported child Rules still contribute their own rules/rulesets after
      // evaluation completes, when the surrounding tree/root context is available.
    } else if (isNode(node, N.Declaration)) {
      /**
       * setDefined assigns through the resolved variable binding. Static
       * VarDeclaration writes stay in place; the fallback below still handles
       * older non-variable declaration placement behavior.
       */
      if (node.options?.setDefined) {
        let key = node.name.toString();
        if (isNode(node, N.VarDeclaration) && this._scopeFrame) {
          const variableHit = lookupScopeFrameVariable(this._scopeFrame, key, {
            bailOnPendingDeclarations: true,
            blockedSource: source => source === node,
            filter: source => source !== node,
            includeAssignmentTargets: true
          });
          if (variableHit.kind === 'live' || variableHit.kind === 'declaration') {
            if (variableHit.readonly || variableHit.cell.readonly) {
              throw new ReferenceError(`"${key}" is readonly`);
            }
            let assignedValue = node.valueNode;
            if (context) {
              const evaluatedValue = assignedValue.eval(context);
              if (!isThenable(evaluatedValue)) {
                assignedValue = evaluatedValue;
              }
            }
            variableHit.cell.value = assignedValue;
            const sourceNode = variableHit.sourceNode;
            if (isNode(sourceNode, N.VarDeclaration)) {
              syncDeclarationValueNode(sourceNode, assignedValue);
            }
            return;
          }
          if (variableHit.kind === 'miss') {
            throw new ReferenceError(`"${key}" is not defined`);
          }
        }
        const lookupOptions: DeclarationFindOptions = { searchParents: true };
        const resultOccurrence = findWritableSetDefinedDeclarationOccurrence(
          this,
          key,
          isNode(node, N.VarDeclaration),
          lookupOptions
        );
        if (!resultOccurrence) {
          throw new ReferenceError(`"${key}" is not defined`);
        }
        const result = resultOccurrence.node;
        if (isNode(node, N.VarDeclaration) && isNode(result, N.VarDeclaration)) {
          let assignedValue = node.valueNode;
          if (context) {
            const evaluatedValue = assignedValue.eval(context);
            if (!isThenable(evaluatedValue)) {
              assignedValue = evaluatedValue;
            }
          }
          if (isNode(result.sourceParent, N.Rules)) {
            syncDeclarationValueNode(result, assignedValue);
            assignScopeFrameVariable(result.sourceParent._scopeFrame, key, assignedValue);
          }
          return;
        }

        // Find the Rules node that contains the found declaration
        if (!isNode(result.sourceParent, N.Rules)) {
          throw new Error(`Could not find parent Rules for declaration '${key}'`);
        }
        const foundRules = result.sourceParent;

        // Create a new declaration with the same name but our value.
        const newDeclaration = node.deriveWithOptions({
          ...node.options,
          setDefined: undefined
        });

        // Adopt the new declaration to the found Rules
        foundRules.adopt(newDeclaration);

        // Add to the value array AFTER the found declaration
        // This ensures it shadows the original and is evaluated after it
        const foundIndex = foundRules.rules.indexOf(result);
        if (foundIndex !== -1) {
          foundRules.rules.splice(foundIndex + 1, 0, newDeclaration);
        } else {
          // If not found in array, add at the beginning
          foundRules.rules.unshift(newDeclaration);
        }

        // Re-run child bookkeeping for the inserted declaration. We skip
        // setDefined processing since we already removed the flag.
        foundRules.registerNode(newDeclaration);
      }

      if (isNode(node, N.VarDeclaration)) {
        if (this._hasStaticName(node)) {
          if (this._scopeFrame) {
            const sourceIdentity = node.sourceNode ?? node;
            const pending = this._scopeFrame.pendingDeclarationNames;
            let write = 0;
            for (let i = 0; i < pending.length; i++) {
              const entry = pending[i]!;
              const entryIdentity = entry.sourceNode ?? entry;
              if (
                entry !== node
                && entry !== sourceIdentity
                && entryIdentity !== sourceIdentity
                && entry.index !== node.index
              ) {
                pending[write++] = entry;
              }
            }
            pending.length = write;
          }
          const name = (node as VarDeclaration).name.valueOf();
          const map = (this.varsByName ??= new Map());
          let arr = map.get(name);
          if (!arr) {
            map.set(name, arr = []);
          }
          const newEntry = createVarDeclarationBindingEntry(node as VarDeclaration, this);
          arr.push(newEntry);
          if (this._scopeFrame) {
            let bucket = this._scopeFrame.declarationBucketsByName.get(name);
            if (!bucket) {
              this._scopeFrame.declarationBucketsByName.set(name, bucket = []);
            }
            let hasBucketEntry = false;
            for (let i = 0; i < bucket.length; i++) {
              if (bucket[i]!.sourceNode === node) {
                hasBucketEntry = true;
                break;
              }
            }
            if (!hasBucketEntry) {
              bucket.push(newEntry);
              setScopeFrameDeclarationBinding(this._scopeFrame, name, newEntry);
            } else {
              const currentEntry = bucket[bucket.length - 1];
              if (currentEntry) {
                setScopeFrameDeclarationBinding(this._scopeFrame, name, currentEntry);
              }
            }
          }
          this.refreshParentDeclarationChildEntryAssignmentSummary(node as VarDeclaration);
        } else if (this._scopeFrame) {
          let hasPendingDeclaration = false;
          for (let i = 0; i < this._scopeFrame.pendingDeclarationNames.length; i++) {
            if (this._scopeFrame.pendingDeclarationNames[i] === node) {
              hasPendingDeclaration = true;
              break;
            }
          }
          if (!hasPendingDeclaration) {
            this._scopeFrame.pendingDeclarationNames.push(node as VarDeclaration);
          }
          this.refreshParentDeclarationChildEntryAssignmentSummary(node as VarDeclaration);
        }
      }
    } else if (isNode(node, N.Ruleset) || isNode(node, N.Mixin)) {
      // Callable lookup crawls Rules.rules directly and filters candidates at lookup/call time.
    } else if (isNode(node, N.Func)) {
      this.setFunctionBinding(node.nameKey, node);
    }
    if (rebuildCallableCache && this._scopeFrame) {
      this._scopeFrame.callableBucketsByName = this.callableLookupCache;
    }
  }

  getDeclarationLookupVersion(key: string): number {
    return Math.max(
      this.declarationLookupVersion,
      this.declarationLookupVersionsByName?.get(key) ?? 0
    );
  }

  private bumpDeclarationLookupVersion(key?: string): void {
    if (key === undefined) {
      this.declarationLookupVersion++;
      return;
    }
    const versions = this.declarationLookupVersionsByName ??= new Map<string, number>();
    versions.set(key, this.getDeclarationLookupVersion(key) + 1);
  }

  private invalidateDirectDeclarationLookup(key?: string): void {
    if (key === undefined) {
      this.directDeclarationsByName = undefined;
      this.directDeclarationLookupCache = undefined;
      return;
    }
    this.directDeclarationsByName?.delete(key);
    if (!this.directDeclarationLookupCache?.size) {
      return;
    }
    const prefix = `${key}\u001f`;
    for (const cacheKey of this.directDeclarationLookupCache.keys()) {
      if (cacheKey.startsWith(prefix)) {
        this.directDeclarationLookupCache.delete(cacheKey);
      }
    }
  }

  push(...nodes: Node[]) {
    for (let node of nodes) {
      this.adopt(node);
      this.rules.push(node);
      this.registerNode(node);
    }
  }

  at(index: number) {
    let target = index;
    if (target < 0) {
      let indexedCount = 0;
      for (let i = 0; i < this.rules.length; i++) {
        if (isIndexedRuleChild(this.rules[i]!)) {
          indexedCount++;
        }
      }
      target = indexedCount + target;
      if (target < 0) {
        return undefined;
      }
    }
    let current = 0;
    for (let i = 0; i < this.rules.length; i++) {
      const node = this.rules[i]!;
      if (!isIndexedRuleChild(node)) {
        continue;
      }
      if (current === target) {
        return node;
      }
      current++;
    }
    return undefined;
  }

  override prepareRegistration(context: Context): MaybePromise<this> {
    return this._prepareRegistrationOnce(context);
  }

  markSourceBackedCallableSurfacePrepared(): void {
    let indexedRuleCount = 0;
    for (let i = 0; i < this.rules.length; i++) {
      const child = this.rules[i]!;
      child.index = isIndexedRuleChild(child) ? indexedRuleCount++ : undefined;
    }
    this._registrationPrepared = true;
    this.registrationPrepared = true;
  }

  private _prepareRegistrationOnce(context: Context): MaybePromise<this> {
    if (!this._registrationPrepared) {
      context.depth++;
      const rules = this;
      const prepState = this._createRegistrationPrepState();
      rules._registrationPrepared = true;
      rules.registrationPrepared = true;
      const { saved, isNestableAtRuleBody } = this._setupRegistrationContext(context, rules);

      let mp: MaybePromise<this>;
      try {
        mp = this._prepareRegistration(rules, context, saved, prepState);
      } catch (error) {
        rules._registrationPrepared = false;
        this._restoreRegistrationAfterError(context, saved);
        throw error;
      }
      const popNestableBody = () => {
        if (isNestableAtRuleBody) {
          context.extendRoots.popExtendRoot();
        }
      };
      if (isThenable(mp)) {
        return (mp as Promise<this>)
          .then((result) => {
            popNestableBody();
            return result;
          })
          .catch((error) => {
            rules._registrationPrepared = false;
            this._restoreRegistrationAfterError(context, saved);
            throw error;
          });
      }
      popNestableBody();
      return mp;
    }
    return this;
  }

  private _setupRegistrationContext(context: Context, rules: Rules): {
    saved: ReturnType<Rules['_snapshotContext']>;
    isNestableAtRuleBody: boolean;
  } {
    const isNestableAtRuleBody = this._isNestableAtRuleBody();
    const saved = this._snapshotContext(context);
    this._setupContextForRules(context, rules);

    // Set context.root early if this is the main root.
    const isMainRoot = !context.root;
    if (isMainRoot) {
      context.root = rules;
    }

    // Set context.root if not already set (needed for visitors during registration prep).
    if (!context.root) {
      context.root = rules;
    }

    // Register main root as extend root if this is the root (needed for extends during registration prep).
    // Check rules === context.root at registration time (not using stale isMainRoot).
    if (rules === context.root && !context.extendRoots.root) {
      context.extendRoots.registerRoot(rules);
      context.extendRoots.pushExtendRoot(rules);
    }

    // Always push nestable at-rule body so inner rulesets register to it (not document root).
    // Needed for both: wrapper (collapseNesting) and direct body (collapseNesting: false).
    if (isNestableAtRuleBody) {
      context.extendRoots.pushExtendRoot(rules);
    }

    return { saved, isNestableAtRuleBody };
  }

  private _isNestableAtRuleBody(): boolean {
    const parentAtRule = isNode(this.sourceParent, N.AtRule) ? this.sourceParent : undefined;
    return parentAtRule ? NESTABLE_AT_RULE_NAMES.has(parentAtRule.name.valueOf()) : false;
  }

  /**
   * Registration prep for the current Rules surface.
   *
   * This is registration setup:
   * assign source-order indices, stabilize registerable identities, register
   * static names, and leave genuinely blocked names in narrow pending buckets.
   */
  private _prepareRegistration(
    rules: Rules,
    context: Context,
    saved: ReturnType<Rules['_snapshotContext']>,
    prepState: RegistrationPrepState
  ): MaybePromise<this> {
    const pendingResult = this._scanRegistrationNodes(rules, context, prepState);
    if (isThenable(pendingResult)) {
      return (pendingResult as Promise<RegistrationPrepState>).then(scanState =>
        this._finishRegistrationPrep(rules, context, saved, scanState)
      );
    }
    return this._finishRegistrationPrep(rules, context, saved, pendingResult as RegistrationPrepState);
  }

  private _scanRegistrationNodes(
    rules: Rules,
    context: Context,
    prepState: RegistrationPrepState
  ): MaybePromise<RegistrationPrepState> {
    // Process each node with a registerable identity, handling both sync and async prep.
    // Comment nodes do not participate in numeric rule indexing.
    let indexedRuleCount = 0;
    const processNode = (node: Node, index: number): MaybePromise<void> => {
      const nodeIndex = isIndexedRuleChild(node) ? indexedRuleCount++ : undefined;
      if (isNode(node, N.Any) && node.role === 'charset') {
        // Charset is root output-order bookkeeping, not name registration.
        if (!context.currentCharset) {
          context.currentCharset = node;
        }
        node.registrationPrepared = true;
        const placeholder = new Nil(
          '',
          undefined,
          node.location.length === 0 ? undefined : node.location
        );
        placeholder.sourceNode = node;
        placeholder.index = nodeIndex;
        rules.rules[index] = placeholder;
        return;
      }
      if (isImportAtRule(node)) {
        // CSS @import hoisting is output-order bookkeeping, not name registration.
        // Preserve the prelude as authored; evaluating here can strip comment tokens.
        queueTopImport(context, node);
        node.registrationPrepared = true;
        const placeholder = new Nil(
          '',
          undefined,
          node.location.length === 0 ? undefined : node.location
        );
        placeholder.sourceNode = node;
        placeholder.index = nodeIndex;
        rules.rules[index] = placeholder;
        return;
      }
      // Nodes that don't register by name (Call, Expression, etc.) skip
      // registration prep and dynamic resolution. They evaluate when the
      // source-order walk reaches them.
      if (!this._isRegisterableType(node)) {
        node.index = nodeIndex;
        return;
      }
      node.index = nodeIndex;
      return this._prepareRegisterableNode(rules, node, index, nodeIndex, prepState, context);
    };
    const processRest = (start: number): MaybePromise<RegistrationPrepState> => {
      for (let i = start; i < rules.rules.length; i++) {
        const result = processNode(rules.rules[i]!, i);
        if (isThenable(result)) {
          return result.then(() => processRest(i + 1));
        }
      }
      return prepState;
    };
    return processRest(0);
  }

  private _finishRegistrationPrep(
    rules: Rules,
    context: Context,
    saved: ReturnType<Rules['_snapshotContext']>,
    prepState: RegistrationPrepState
  ): MaybePromise<this> {
    this._stampRegistrationMaps(rules);
    if (!this._hasPendingPrep(prepState)) {
      this._restoreRegistrationContext(context, saved);
      return this;
    }
    const declarationResult = this._finishDeclarationNameRegistrationPrep(rules, context, prepState.declarationNames);
    const finishAfterDeclarations = () => {
      return this._finishOrderedIdentityRegistrationPrep(rules, context, saved, prepState);
    };
    if (isThenable(declarationResult)) {
      return (declarationResult as Promise<void>).then(finishAfterDeclarations);
    }
    return finishAfterDeclarations();
  }

  private _stampRegistrationMaps(rules: Rules): void {
    // Let fast lookup distinguish "registration prep completed with nothing
    // registerable" from "scope never processed at all".
    rules.varsByName ??= new Map();
  }

  private _prepareRegisterableNode(
    rules: Rules,
    node: Node,
    index: number,
    nodeIndex: number | undefined,
    prepState: RegistrationPrepState,
    context: Context
  ): MaybePromise<void> {
    if (!this._hasStaticName(node)) {
      this._addPendingPrep(prepState, node);
      return;
    }
    if (node.registrationPrepared) {
      this._storePreparedRegistrationNode(rules, node, index, nodeIndex, prepState, context);
      return;
    }
    // Prepare static identities before registration. Rulesets still need selector/keySet prep.
    const canReuseCanonicalDeclaration = (
      isNode(node, N.Declaration | N.VarDeclaration)
      && (!node.options?.assign || node.options.assign === ':')
      && !node.options?.normalizedFromAssign
    );
    const prepared = canReuseCanonicalDeclaration
      ? node.prepareRegistration(context, { reuseCanonical: true })
      : node.prepareRegistration(context);
    if (isThenable(prepared)) {
      return prepared.then((preparedNode) => {
        this._storePreparedRegistrationNode(rules, preparedNode, index, nodeIndex, prepState, context);
      });
    }
    this._storePreparedRegistrationNode(rules, prepared, index, nodeIndex, prepState, context);
  }

  /**
   * Helper to check if a value is static (either a Node with F_STATIC flag or a primitive value)
   */
  private _isStatic(value: unknown): boolean {
    if (hasFlagMethod(value)) {
      return value.hasFlag(F_STATIC);
    }
    // Primitive values (strings, numbers, etc.) are considered static
    return true;
  }

  /**
   * Check if a node type participates in name-based registration.
   * Only these node types have names/selectors that registration finalization
   * needs to resolve. Everything else (Call, Expression, Comment, etc.) waits
   * for the normal source-order eval walk.
   */
  private _isRegisterableType(node: Node): boolean {
    return isNode(node, N.VarDeclaration | N.Declaration | N.Mixin | N.Ruleset | N.Func) || isStyleImportRegistrationNode(node);
  }

  private collectStaticDeclarationInvalidationKeys(rules: Rules, keys: Set<string>): boolean {
    if (rulesHasCarriedReferenceImportSurface(rules)) {
      return false;
    }
    const value = rules.rules;
    for (let i = 0; i < value.length; i++) {
      const node = value[i]!;
      if (node.type === 'StyleImport') {
        return false;
      }
      if (isNode(node, N.Declaration | N.VarDeclaration) && !node.options?.setDefined) {
        if (!this._hasStaticName(node)) {
          return false;
        }
        keys.add(String(node.name.valueOf()));
        continue;
      }
      const child = childRulesOf(node);
      if (child && !this.collectStaticDeclarationInvalidationKeys(child, keys)) {
        return false;
      }
    }
    return true;
  }

  private addDirectDeclarationInvalidationKeys(keys: Set<string>): void {
    for (const key of keys) {
      this.bumpDeclarationLookupVersion(key);
      this.invalidateDirectDeclarationLookup(key);
    }
  }

  private _storePreparedRegistrationNode(
    rules: Rules,
    node: Node,
    index: number,
    nodeIndex: number | undefined,
    prepState: RegistrationPrepState,
    context: Context
  ): void {
    rules.rules[index] = node;
    node.index = nodeIndex;
    if (rules.options.sourceBackedImportPlacement !== true || node.sourceParent === undefined) {
      rules.adopt(node);
    } else {
      const childRules = childCallableRulesOf(node);
      if (childRules) {
        rules.addDirectChildRuleEntry(childRules, rules.getDirectChildRulesVisibility(childRules));
      }
    }
    // After prep, check if it still has a static name.
    if (this._hasStaticName(node)) {
      const registrationContext = rules._scopeFrame?.hasLiveBindings
        ? context
        : undefined;
      this._registerNodeIfEligible(rules, node, registrationContext);
      return;
    }
    this._addPendingPrep(prepState, node);
  }

  /**
   * Check if a node has a static name that can be registered immediately
   */
  private _hasStaticName(node: Node): boolean {
    if (isNode(node, N.VarDeclaration)) {
      const name = node.name;
      return this._isStatic(name);
    }
    if (isNode(node, N.Mixin)) {
      const name = node.name;
      return this._isStatic(name);
    }
    if (isNode(node, N.Declaration)) {
      const name = node.name;
      return this._isStatic(name);
    }
    if (isNode(node, N.Func)) {
      const name = node.name;
      return name ? this._isStatic(name) : false;
    }
    if (isStyleImportRegistrationNode(node)) {
      const path = node.path;
      return this._isStatic(path);
    }
    if (isNode(node, N.Ruleset)) {
      const selector = node.selector;
      // BasicSelector, CompoundSelector, ComplexSelector etc. are always static
      // Only Interpolated selectors need resolution
      if (
        isNode(selector, N.BasicSelector)
        || isNode(selector, N.CompoundSelector)
        || isNode(selector, N.ComplexSelector)
        || isNode(selector, N.SelectorList)
      ) {
        return true;
      }
      // After identity prep, the selector should be resolved to static identifiers.
      if (node.registrationPrepared) {
        return true;
      }
      // Check F_STATIC flag for other selector types.
      if (hasFlagMethod(selector)) {
        return selector.hasFlag(F_STATIC);
      }
      return false;
    }
    // For other registerable node types, check the F_STATIC flag
    return node.hasFlag(F_STATIC);
  }

  /**
   * Apply child bookkeeping for nodes that can affect lookup/eval state.
   */
  private _registerNodeIfEligible(rules: Rules, node: Node, context?: Context) {
    if (isNode(node, N.Declaration)) {
      rules.registerNode(node, undefined, context);
    } else if (isNode(node, N.Mixin)) {
      rules.registerNode(node, undefined, context);
    } else if (isNode(node, N.Ruleset)) {
      rules.registerNode(node, undefined, context);
    } else if (isNode(node, N.Func)) {
      rules.registerNode(node, undefined, context);
    }
  }

  private _finishDeclarationNameRegistrationPrep(
    rules: Rules,
    context: Context,
    pendingDeclarationNames: PendingDeclarationNamePrepState
  ): MaybePromise<void> {
    let result: MaybePromise<void> | undefined;
    if (pendingDeclarationNames.nodes.length > 0) {
      const handleResolvedNode = (resolvedNode: Node, node: Node, stillUnresolved: Node[]): boolean => {
        return this._recordResolvedRegistrationNode(
          rules,
          pendingDeclarationNames.resolvedNodes,
          resolvedNode,
          node,
          stillUnresolved
        );
      };
      result = this._retryPendingDeclarationNamePrep(
        context,
        pendingDeclarationNames.nodes,
        handleResolvedNode
      );
    }
    const finish = () => {
      this._applyResolvedRegistrationNodes(rules, pendingDeclarationNames.resolvedNodes);
    };
    if (isThenable(result)) {
      return (result as Promise<void>).then(finish);
    }
    return finish();
  }

  private _finishOrderedIdentityRegistrationPrep(
    rules: Rules,
    context: Context,
    saved: ReturnType<Rules['_snapshotContext']>,
    prepState: RegistrationPrepState
  ): MaybePromise<this> {
    const handleResolvedNode = (resolvedNode: Node, node: Node, stillUnresolved: Node[]): boolean => {
      return this._recordResolvedRegistrationNode(
        rules,
        prepState.orderedIdentity.resolvedNodes,
        resolvedNode,
        node,
        stillUnresolved
      );
    };

    const orderedIdentities = prepState.orderedIdentity.nodes;
    const orderedResult = orderedIdentities.length === 0
      ? undefined
      : this._prepareOrderedIdentitiesInSourceOrder(context, orderedIdentities, handleResolvedNode);
    const finish = () => {
      this._applyResolvedRegistrationNodes(rules, prepState.orderedIdentity.resolvedNodes);
      this._restoreRegistrationContext(context, saved);
      return this;
    };
    if (isThenable(orderedResult)) {
      return (orderedResult as Promise<void>).then(finish);
    }
    return finish();
  }

  private _recordResolvedRegistrationNode(
    rules: Rules,
    resolvedNodes: Node[],
    resolvedNode: Node,
    node: Node,
    stillUnresolved: Node[]
  ): boolean {
    if (resolvedNode.index === undefined) {
      resolvedNode.index = node.index;
    }
    if (isNode(resolvedNode, N.Nil) || this._hasStaticName(resolvedNode)) {
      resolvedNodes.push(resolvedNode);
      this._registerNodeIfEligible(rules, resolvedNode);
      return true;
    }
    stillUnresolved.push(resolvedNode);
    return false;
  }

  private _applyResolvedRegistrationNodes(rules: Rules, resolvedNodes: Node[]): void {
    if (resolvedNodes.length === 0) {
      return;
    }
    const resolvedByIndex = new Map<number | undefined, Node>();
    for (const resolvedNode of resolvedNodes) {
      if (!resolvedByIndex.has(resolvedNode.index)) {
        resolvedByIndex.set(resolvedNode.index, resolvedNode);
      }
    }
    for (let i = 0; i < rules.rules.length; i++) {
      const node = rules.rules[i]!;
      const resolvedNode = resolvedByIndex.get(node.index);
      if (resolvedNode && resolvedNode !== node) {
        rules.rules[i] = resolvedNode;
        rules.adopt(resolvedNode);
        if (isNode(node, N.VarDeclaration) && isNode(resolvedNode, N.VarDeclaration)) {
          this._replacePendingDeclarationNameNode(rules, node, resolvedNode);
        }
      }
    }
  }

  private _replacePendingDeclarationNameNode(
    rules: Rules,
    sourceNode: VarDeclaration,
    replacement: VarDeclaration
  ): void {
    const pending = rules._scopeFrame?.pendingDeclarationNames;
    if (!pending?.length) {
      return;
    }
    const sourceIdentity = sourceNode.sourceNode ?? sourceNode;
    for (let i = 0; i < pending.length; i++) {
      const entry = pending[i]!;
      const entryIdentity = entry.sourceNode ?? entry;
      if (entry === sourceNode || entry === sourceIdentity || entryIdentity === sourceIdentity) {
        pending[i] = replacement;
      }
    }
  }

  private _addPendingPrep(prepState: RegistrationPrepState, node: Node): void {
    if (isNode(node, N.VarDeclaration | N.Declaration)) {
      prepState.declarationNames.nodes.push(node);
      return;
    }
    prepState.orderedIdentity.nodes.push(node);
  }

  private _hasPendingPrep(prepState: RegistrationPrepState): boolean {
    return prepState.declarationNames.nodes.length > 0 || prepState.orderedIdentity.nodes.length > 0;
  }

  private _retryPendingDeclarationNamePrep(
    context: Context,
    pendingDeclarations: Node[],
    handleResolvedNode: PendingPrepHandler
  ): MaybePromise<void> {
    // Declaration names are lookup identities. One pending declaration can
    // unblock another by registering a variable name used in interpolation.
    let attempts = 0;
    const unresolvedDeclarations = new Array<Node>(pendingDeclarations.length);
    for (let i = 0; i < pendingDeclarations.length; i++) {
      unresolvedDeclarations[i] = pendingDeclarations[i]!;
    }

    const resolveDeclarations = (): MaybePromise<void> => {
      attempts++;
      if (attempts > MAX_DECLARATION_NAME_REGISTRATION_RETRIES || unresolvedDeclarations.length === 0) {
        return;
      }
      const stillUnresolved: Node[] = [];
      let madeProgress = false;

      for (let i = 0; i < unresolvedDeclarations.length; i++) {
        const node = unresolvedDeclarations[i]!;
        try {
          const result = node.prepareRegistration(context);

          if (isThenable(result)) {
            const remaining: Node[] = [];
            for (let nextIndex = i + 1; nextIndex < unresolvedDeclarations.length; nextIndex++) {
              remaining.push(unresolvedDeclarations[nextIndex]!);
            }
            return result.then((resolvedNode) => {
              if (handleResolvedNode(resolvedNode, node, stillUnresolved)) {
                madeProgress = true;
              }
              unresolvedDeclarations.length = 0;
              for (let nextIndex = 0; nextIndex < stillUnresolved.length; nextIndex++) {
                unresolvedDeclarations.push(stillUnresolved[nextIndex]!);
              }
              for (let nextIndex = 0; nextIndex < remaining.length; nextIndex++) {
                unresolvedDeclarations.push(remaining[nextIndex]!);
              }
              if (madeProgress && unresolvedDeclarations.length > 0) {
                return resolveDeclarations();
              }
            });
          }

          if (handleResolvedNode(result as Node, node, stillUnresolved)) {
            madeProgress = true;
          }
        } catch {
          stillUnresolved.push(node);
        }
      }

      if (madeProgress && stillUnresolved.length > 0) {
        unresolvedDeclarations.length = 0;
        for (let i = 0; i < stillUnresolved.length; i++) {
          unresolvedDeclarations.push(stillUnresolved[i]!);
        }
        return resolveDeclarations();
      }
    };

    return resolveDeclarations();
  }

  private _prepareOrderedIdentitiesInSourceOrder(
    context: Context,
    orderedIdentities: Node[],
    handleResolvedNode: PendingPrepHandler
  ): MaybePromise<void> {
    // Keep these in source order. Callable names, selector identity, and import
    // paths still share this one-shot path until each surface has ordering tests
    // proving it can move independently.
    const resolveOrderedOnce = (): MaybePromise<void> => {
      for (let i = 0; i < orderedIdentities.length; i++) {
        const node = orderedIdentities[i]!;
        try {
          const result = node.prepareRegistration(context);

          if (isThenable(result)) {
            const remaining: Node[] = [];
            for (let nextIndex = i + 1; nextIndex < orderedIdentities.length; nextIndex++) {
              remaining.push(orderedIdentities[nextIndex]!);
            }
            return result.then((resolvedNode) => {
              handleResolvedNode(resolvedNode, node, []);
              // Continue with remaining nodes
              orderedIdentities.length = 0;
              for (let nextIndex = 0; nextIndex < remaining.length; nextIndex++) {
                orderedIdentities.push(remaining[nextIndex]!);
              }
              return resolveOrderedOnce();
            });
          }

          handleResolvedNode(result as Node, node, []);
        } catch {
          // Can't resolve during registration prep — leave in place for eval.
        }
      }
    };

    return resolveOrderedOnce();
  }

  /** Save current context roots to restore later */
  private _snapshotContext(context: Context) {
    return {
      rulesContext: context.rulesContext,
      treeContext: context.treeContext,
      treeRoot: context.treeRoot,
      root: context.root,
      extendRootStackLength: context.extendRoots.extendRootStack.length
    } as const;
  }

  private _restoreRegistrationContext(context: Context, saved: ReturnType<Rules['_snapshotContext']>): void {
    context.rulesContext = saved.rulesContext;
    context.treeRoot = saved.treeRoot;
    if (saved.root !== undefined) {
      context.root = saved.root;
    }
  }

  private _popExtendRootStackTo(context: Context, saved: ReturnType<Rules['_snapshotContext']>): void {
    while (context.extendRoots.extendRootStack.length > saved.extendRootStackLength) {
      context.extendRoots.popExtendRoot();
    }
  }

  private _restoreRegistrationAfterError(context: Context, saved: ReturnType<Rules['_snapshotContext']>): void {
    this._restoreRegistrationContext(context, saved);
    this._popExtendRootStackTo(context, saved);
  }

  /** Setup context for evaluating these rules */
  private _setupContextForRules(context: Context, rules: Rules) {
    const treeContext = context.treeContext;
    // Only switch treeContext if the rules have one AND it's different
    // Dynamically created Rules (e.g., mixin parameter wrappers) may not have treeContext
    // and we don't want to lose leakyRules and other settings
    // IMPORTANT: Check the explicit tree context, not treeContext (getter that lazily creates).
    const rulesTreeContext = rules._treeContext;
    if (rulesTreeContext && (!treeContext || treeContext !== rulesTreeContext)) {
      context.allRoots.push(rules);
      context.treeContext = rulesTreeContext;
      context.treeRoot = rules;
    }
    // Always set root if not set - needed for extends to work with API-created Rules
    context.root ??= rules;
    context.rulesContext = rules;
  }

  /** Assign depth-first document order to every Ruleset under the given Rules (single walk, source order). */
  private _assignDocumentOrderDepthFirst(rules: Rules, map: WeakMap<Ruleset, number>, counter: { value: number }): void {
    const value = rules.rules;
    if (!isArray(value)) {
      return;
    }
    for (const node of value) {
      if (isNode(node, N.Ruleset)) {
        map.set(node, counter.value);
        counter.value++;
      }
      const innerRules = childRulesOf(node);
      if (innerRules) {
        this._assignDocumentOrderDepthFirst(innerRules, map, counter);
      }
    }
  }

  private _evaluateSourceOrder(rules: Rules, context: Context): MaybePromise<boolean> {
    let rulesToHoist = false;
    const pendingImports: Array<[number, Node]> = [];

    const applyResult = (idx: number, rule: Node, result: Node | undefined): void => {
      if (result === undefined) {
        return;
      }
      if (result !== rule) {
        rules.rules[idx] = result;
        if (isNode(result, N.Rules)) {
          result.index = idx;
          rules.adopt(result);
          rules.registerNode(result, {
            rulesVisibility: result.options.rulesVisibility,
            readonly: result.options.readonly
          }, context);
          return;
        }
        rules.adopt(result);
      }
      if (result.hoistToRoot) {
        rulesToHoist = true;
      }
    };

    const evaluateEntry = (idx: number, rule: Node, allowImportRetry: boolean): MaybePromise<void> => {
      if (isNode(rule, N.VarDeclaration)) {
        if (rule.options?.setDefined) {
          rules.registerNode(rule, undefined, context);
        }
        return;
      }
      const handleError = (error: unknown): Node | undefined => {
        if (
          allowImportRetry
          && isStyleImportRegistrationNode(rule)
          && isStyleImportPathResolutionError(error)
        ) {
          pendingImports.push([idx, rule]);
          return;
        }
        throw error;
      };
      const evalRuleInRulesContext = (): MaybePromise<Node | undefined> => {
        const savedRulesContext = context.rulesContext;
        context.rulesContext = rules;
        try {
          const value = rule.eval(context);
          if (isThenable(value)) {
            return (value as Promise<Node>)
              .catch(handleError)
              .finally(() => {
                context.rulesContext = savedRulesContext;
              });
          }
          context.rulesContext = savedRulesContext;
          return value;
        } catch (error) {
          context.rulesContext = savedRulesContext;
          return handleError(error);
        }
      };
      const result = evalRuleInRulesContext();
      if (isThenable(result)) {
        return (result as Promise<Node | undefined>).then(resolved => applyResult(idx, rule, resolved));
      }
      applyResult(idx, rule, result as Node | undefined);
    };

    // These are the two eval-owned side-effect lanes left after removing the
    // broad priority table. Imports can provide symbols to the whole file, and
    // calls can produce declarations that Less property accessors read.
    const evaluateLane = (
      shouldEvaluate: (rule: Node) => boolean,
      allowImportRetry: boolean
    ): MaybePromise<void> => {
      const evaluateRest = (start: number): MaybePromise<void> => {
        for (let idx = start; idx < rules.rules.length; idx++) {
          const rule = rules.rules[idx]!;
          if (!shouldEvaluate(rule)) {
            continue;
          }
          const result = evaluateEntry(idx, rule, allowImportRetry);
          if (isThenable(result)) {
            return result.then(() => evaluateRest(idx + 1));
          }
        }
      };
      return evaluateRest(0);
    };
    const drainPendingImports = (allowRetry: boolean): MaybePromise<void> => {
      if (pendingImports.length === 0) {
        return;
      }
      const imports = pendingImports.splice(0);
      const drainRest = (start: number): MaybePromise<void> => {
        for (let i = start; i < imports.length; i++) {
          const [idx, rule] = imports[i]!;
          const drained = evaluateEntry(idx, rule, allowRetry);
          if (isThenable(drained)) {
            return drained.then(() => drainRest(i + 1));
          }
        }
      };
      const drained = drainRest(0);
      if (isThenable(drained) && allowRetry) {
        return (drained as Promise<void>).then(() => drainPendingImports(false));
      }
      return drained;
    };
    const prepareDynamicIdentityLane = (): MaybePromise<void> => {
      if (rules.options.sourceBackedCallableSurface !== true) {
        return;
      }
      const needsSourceBackedIdentityPrep = (node: Node): boolean => {
        if (!this._isRegisterableType(node)) {
          return false;
        }
        if (!this._hasStaticName(node)) {
          return true;
        }
        return isNode(node, N.Declaration)
          && node.options?.assign !== undefined
          && node.options.assign !== ':';
      };
      const prepareRest = (start: number): MaybePromise<void> => {
        for (let idx = start; idx < rules.rules.length; idx++) {
          const node = rules.rules[idx]!;
          if (!needsSourceBackedIdentityPrep(node)) {
            continue;
          }
          const savedRulesContext = context.rulesContext;
          context.rulesContext = rules;
          let prepared: MaybePromise<Node>;
          try {
            prepared = isNode(node, N.Declaration | N.VarDeclaration)
              ? node.prepareRegistration(context, { reuseCanonical: true })
              : node.prepareRegistration(context);
          } catch (error) {
            context.rulesContext = savedRulesContext;
            throw error;
          }
          const applyPrepared = (preparedNode: Node): void => {
            context.rulesContext = savedRulesContext;
            if (preparedNode !== node) {
              rules.rules[idx] = preparedNode;
              preparedNode.index = node.index;
              rules.adopt(preparedNode);
            }
            if (this._hasStaticName(preparedNode)) {
              this._registerNodeIfEligible(rules, preparedNode, context);
            }
          };
          if (isThenable(prepared)) {
            return (prepared as Promise<Node>).then((preparedNode) => {
              applyPrepared(preparedNode);
              return prepareRest(idx + 1);
            }, (error) => {
              context.rulesContext = savedRulesContext;
              throw error;
            });
          }
          applyPrepared(prepared as Node);
        }
      };
      return prepareRest(0);
    };

    const evaluateImports = evaluateLane(isStyleImportRegistrationNode, true);
    const evaluateBody = (): MaybePromise<boolean> => {
      const importDrain = drainPendingImports(false);
      const afterImports = () => {
        const preparedIdentities = prepareDynamicIdentityLane();
        const afterPreparedIdentities = () => {
          const calls = evaluateLane(rule => isNode(rule, N.Call), false);
          const afterCalls = () => {
            const normal = evaluateLane((rule) => {
              if (isNode(rule, N.VarDeclaration)) {
                return rule.options?.setDefined === true;
              }
              if (isStyleImportRegistrationNode(rule) || isNode(rule, N.Call)) {
                return false;
              }
              return true;
            }, false);
            if (isThenable(normal)) {
              return (normal as Promise<void>).then(() => rulesToHoist);
            }
            return rulesToHoist;
          };
          if (isThenable(calls)) {
            return (calls as Promise<void>).then(afterCalls);
          }
          return afterCalls();
        };
        if (isThenable(preparedIdentities)) {
          return (preparedIdentities as Promise<void>).then(afterPreparedIdentities);
        }
        return afterPreparedIdentities();
      };
      if (isThenable(importDrain)) {
        return (importDrain as Promise<void>).then(afterImports);
      }
      return afterImports();
    };

    if (isThenable(evaluateImports)) {
      return (evaluateImports as Promise<void>).then(evaluateBody);
    }
    return evaluateBody();
  }

  /**
   * Coalesce assignment-normalized declaration chains in one stage after evaluation.
   * This handles both in-scope merges and merges that span call-produced Rules blocks.
   */
  private _coalesceMergedDeclarations(rules: Rules): void {
    type DeclOccurrence = {
      node: Node;
      ownerRules: Rules;
    };
    const isMergedAssign = (assign: unknown): boolean => (
      assign === '+:' || assign === '&,:' || assign === '&_:'
    );
    const getDeclValue = (decl: Node): Node | undefined => {
      if (!isNode(decl, N.Declaration)) {
        return undefined;
      }
      return decl.valueNode;
    };
    const replaceOwnedDeclaration = (
      ownerRules: Rules,
      source: Declaration,
      replacement: Declaration
    ): Declaration => {
      const index = ownerRules.rules.indexOf(source);
      if (index !== -1) {
        ownerRules.rules[index] = replacement;
        const key = String(replacement.name.valueOf());
        ownerRules.bumpDeclarationLookupVersion(key);
        ownerRules.invalidateDirectDeclarationLookup(key);
      }
      ownerRules.adopt(replacement);
      return replacement;
    };
    const replaceDeclarationValue = (decl: Declaration, value: Node, ownerRules?: Rules): Declaration => {
      const replacement = decl.deriveWithParts({ value });
      if (ownerRules && ownerRules !== decl.sourceParent && ownerRules.rules.includes(decl)) {
        return replaceOwnedDeclaration(ownerRules, decl, replacement);
      }
      return isNode(decl.sourceParent, N.Rules)
        ? replaceOwnedDeclaration(decl.sourceParent, decl, replacement)
        : replacement;
    };
    const reuseMergedValue = (value: Node): Node => value;
    const forEachMergedItem = (
      value: Node,
      assign: string,
      visit: (node: Node) => boolean | void
    ): boolean => {
      const stack: Node[] = [value];
      let keepGoing = true;
      while (stack.length > 0 && keepGoing) {
        const node = stack.pop()!;
        if (isNode(node, N.List) || (assign === '&_:' && isNode(node, N.Sequence))) {
          for (let i = node.items.length - 1; i >= 0; i--) {
            stack.push(node.items[i]!);
          }
          continue;
        }
        const isEmptyPlaceholder = isNode(node, N.Nil)
          || (isNode(node, N.Any) && node.value === '');
        if (!isEmptyPlaceholder) {
          keepGoing &&= visit(node) !== false;
        }
      }
      return keepGoing;
    };
    const collectMergedItems = (value: Node, assign: string): Node[] => {
      const items: Node[] = [];
      forEachMergedItem(value, assign, (node) => {
        items.push(node);
      });
      return items;
    };
    const sameMergedItem = (left: Node, right: Node): boolean => {
      return left.compare(right) === 0 || String(left.valueOf()) === String(right.valueOf());
    };
    const collapseRepeatedMergedPrefix = (items: Node[]): Node[] => {
      for (let start = items.length - 1; start > 0; start--) {
        if (!sameMergedItem(items[0]!, items[start]!)) {
          continue;
        }
        let matches = true;
        const comparable = Math.min(start, items.length - start);
        for (let i = 1; i < comparable; i++) {
          if (!sameMergedItem(items[i]!, items[start + i]!)) {
            matches = false;
            break;
          }
        }
        if (matches) {
          return items.slice(start);
        }
      }
      return items;
    };
    const findMergedItemSpan = (items: Node[], span: Node[]): number => {
      if (span.length === 0 || span.length > items.length) {
        return -1;
      }
      const lastStart = items.length - span.length;
      for (let start = 0; start <= lastStart; start++) {
        let matches = true;
        for (let i = 0; i < span.length; i++) {
          if (!sameMergedItem(items[start + i]!, span[i]!)) {
            matches = false;
            break;
          }
        }
        if (matches) {
          return start;
        }
      }
      return -1;
    };
    const rotateExpandedMergedSequence = (
      priorValue: Node,
      nextValue: Node,
      assign: string
    ): Node | undefined => {
      if (assign !== '&_:') {
        return undefined;
      }
      const priorItems = collectMergedItems(priorValue, assign);
      const nextItems = collectMergedItems(nextValue, assign);
      const priorStart = findMergedItemSpan(nextItems, priorItems);
      if (priorStart <= 0) {
        return undefined;
      }
      return spaced([
        ...priorItems,
        ...nextItems.slice(0, priorStart)
      ]);
    };
    const startsWithMergedValue = (value: Node, prefix: Node, assign: string): boolean => {
      const prefixItems = collectMergedItems(prefix, assign);
      if (prefixItems.length === 0) {
        return false;
      }
      let index = 0;
      let matches = true;
      forEachMergedItem(value, assign, (node) => {
        if (index >= prefixItems.length) {
          return false;
        }
        if (!sameMergedItem(prefixItems[index]!, node)) {
          matches = false;
          return false;
        }
        index++;
      });
      return matches && index === prefixItems.length;
    };
    const mergeDeclarationValues = (priorValue: Node, nextValue: Node, assign: string): Node => {
      if (assign === '&_:') {
        return spaced([reuseMergedValue(priorValue), reuseMergedValue(nextValue)]);
      }
      const priorItems = collectMergedItems(priorValue, assign);
      const nextItems = collectMergedItems(nextValue, assign);
      let nextStart = 0;
      if (priorItems.length > 0 && nextItems.length > 0) {
        const comparablePrefix = Math.min(priorItems.length, nextItems.length);
        while (
          nextStart < comparablePrefix
          && sameMergedItem(priorItems[nextStart]!, nextItems[nextStart]!)
        ) {
          nextStart++;
        }
        if (nextStart === 0) {
          const lastPrior = priorItems[priorItems.length - 1]!;
          const firstNext = nextItems[0]!;
          if (sameMergedItem(lastPrior, firstNext)) {
            nextStart = 1;
          }
        }
      }
      let mergedItems = new Array<Node>(priorItems.length + nextItems.length - nextStart);
      let mergedIndex = 0;
      for (let i = 0; i < priorItems.length; i++) {
        mergedItems[mergedIndex++] = reuseMergedValue(priorItems[i]!);
      }
      for (let i = nextStart; i < nextItems.length; i++) {
        mergedItems[mergedIndex++] = reuseMergedValue(nextItems[i]!);
      }
      mergedItems = collapseRepeatedMergedPrefix(mergedItems);
      return new List(mergedItems);
    };
    const inlineCrossScopeMergedLeadingReference = (
      decl: Node,
      priorValue: Node,
      assign: string,
      ownerRules: Rules
    ): Node => {
      if (!isNode(decl, N.Declaration)) {
        return decl;
      }
      const currentValue = getDeclValue(decl);
      const container = assign === '&_:'
        ? (isNode(currentValue, N.Sequence) ? currentValue : undefined)
        : (isNode(currentValue, N.List) ? currentValue : undefined);
      if (!container || container.items.length === 0) {
        return decl;
      }
      const first = container.items[0];
      if (!isNode(first, N.Reference) || first.options?.type !== 'declaration') {
        return decl;
      }
      const inlinedItems = new Array<Node>(container.items.length);
      inlinedItems[0] = reuseMergedValue(priorValue);
      for (let i = 1; i < container.items.length; i++) {
        inlinedItems[i] = reuseMergedValue(container.items[i]!);
      }
      const inlinedValue = assign === '&_:'
        ? spaced(inlinedItems)
        : new List(inlinedItems);
      return replaceDeclarationValue(decl, inlinedValue, ownerRules);
    };
    const composeMergedValue = (
      decl: Node,
      ownerRules: Rules,
      prior: Node,
      assign: string,
      priorAccumulatedValue?: Node,
      nextIncrementValue?: Node
    ): { value: Node; node: Node } | undefined => {
      if (!isNode(decl, N.Declaration) || !isNode(prior, N.Declaration)) {
        return undefined;
      }
      const nextDeclValue = nextIncrementValue ?? getDeclValue(decl);
      if (!nextDeclValue) {
        return undefined;
      }
      const basePriorValue = priorAccumulatedValue
        ?? getDeclValue(prior);
      if (!basePriorValue) {
        return undefined;
      }
      if (startsWithMergedValue(nextDeclValue, basePriorValue, assign)) {
        return { value: nextDeclValue, node: decl };
      }
      const mergedValue = rotateExpandedMergedSequence(basePriorValue, nextDeclValue, assign)
        ?? mergeDeclarationValues(basePriorValue, nextDeclValue, assign);
      let outputDecl = replaceDeclarationValue(decl, mergedValue, ownerRules);
      outputDecl = normalizeMergedDeclarationValue(outputDecl, ownerRules);
      const declImportant = decl.important;
      const priorImportant = prior.important;
      if (!declImportant && priorImportant) {
        outputDecl = replaceOwnedDeclaration(
          ownerRules,
          outputDecl,
          outputDecl.deriveWithParts({
            value: outputDecl.valueNode,
            important: priorImportant
          })
        );
      }
      const mergedDeclValue = getDeclValue(outputDecl);
      return mergedDeclValue ? { value: mergedDeclValue, node: outputDecl } : undefined;
    };
    const normalizeMergedDeclarationValue = (node: Node, ownerRules?: Rules): Declaration => {
      if (!isNode(node, N.Declaration)) {
        throw new TypeError('Expected declaration while normalizing merged declaration value');
      }
      const declValue = getDeclValue(node);
      if (!declValue) {
        return node;
      }
      const current = declValue;
      if (!isNode(current, N.List) || current.items.length === 0) {
        return node;
      }
      const first = current.items[0];
      const isEmptyPlaceholder = Boolean(
        first
        && (
          isNode(first, N.Nil)
          || (isNode(first, N.List) && first.items.length === 0)
          || (isNode(first, N.Any) && first.value === '')
        )
      );
      if (!isEmptyPlaceholder) {
        return node;
      }
      if (current.items.length === 1) {
        return replaceDeclarationValue(node, new Nil(), ownerRules);
      }
      if (current.items.length === 2) {
        return replaceDeclarationValue(node, reuseMergedValue(current.items[1]!), ownerRules);
      }
      const rest = new Array<Node>(current.items.length - 1);
      for (let i = 1; i < current.items.length; i++) {
        rest[i - 1] = reuseMergedValue(current.items[i]!);
      }
      return replaceDeclarationValue(node, new List(rest), ownerRules);
    };

    const lastVisibleByName = new Map<string, DeclOccurrence>();
    const mergedAnchorByName = new Map<string, DeclOccurrence>();
    const accumulatedValueByName = new Map<string, Node>();
    const hasSourceAncestor = (node: Node, type: 'Mixin' | 'Ruleset'): boolean => {
      let cursor = node.sourceParent;
      while (cursor) {
        if (cursor.type === type) {
          return true;
        }
        cursor = cursor.sourceParent;
      }
      return false;
    };
    const containsReference = (node: Node): boolean => {
      const stack: unknown[] = [node];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (isNode(current, N.Reference)) {
          return true;
        }
        if (!(current instanceof Node)) {
          if (Array.isArray(current)) {
            for (let i = 0; i < current.length; i++) {
              stack.push(current[i]);
            }
          } else if (isPlainObject(current)) {
            for (const key in current) {
              stack.push(current[key]);
            }
          }
          continue;
        }
        const value = current.value;
        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            const child = value[i];
            if (child instanceof Node) {
              stack.push(child);
            }
          }
        } else if (isPlainObject(value)) {
          for (const key in value) {
            stack.push(value[key]);
          }
        }
      }
      return false;
    };
    const hideMergedAnchor = (occurrence: DeclOccurrence, currentNode: Node): void => {
      if (occurrence.node === currentNode && occurrence.ownerRules !== undefined) {
        occurrence.ownerRules.removeFlag(F_VISIBLE);
        return;
      }
      const outputChild = getMixinOutputChildForSource(occurrence.ownerRules, occurrence.node);
      if (outputChild) {
        if (outputChild === occurrence.node) {
          if (hasSourceAncestor(occurrence.node, 'Mixin')) {
            occurrence.node.removeFlag(F_VISIBLE);
            return;
          }
          const slot = occurrence.ownerRules.options.mixinOutputSlot;
          (slot!.hiddenOutputSources ??= new WeakSet()).add(occurrence.node);
          return;
        }
        outputChild.removeFlag(F_VISIBLE);
        return;
      }
      occurrence.node.removeFlag(F_VISIBLE);
    };
    const processDeclarationOccurrence = (node: Node, ownerRules: Rules): void => {
      if (!isNode(node, N.Declaration)) {
        return;
      }
      let currentNode: Node = node;
      const name = String(node.name);
      const assign = String(node.options.normalizedFromAssign ?? node.options.assign ?? '');
      const merged = isMergedAssign(assign);
      if (!merged) {
        mergedAnchorByName.delete(name);
        accumulatedValueByName.delete(name);
        if (node.visible) {
          lastVisibleByName.set(name, { node, ownerRules });
        }
        return;
      }
      currentNode = normalizeMergedDeclarationValue(node, ownerRules);
      let currentAccumulatedValue: Node | undefined;

      const existingAnchor = mergedAnchorByName.get(name);
      const prior = assign === '+:'
        ? lastVisibleByName.get(name)
        : existingAnchor;
      const priorAccumulatedValue = accumulatedValueByName.get(name);
      const needsCrossScopeCompose = prior
        && prior.ownerRules !== ownerRules;
      const crossesMixinOutputBoundary = Boolean(
        prior?.ownerRules.options.mixinOutputSlot
        || ownerRules.options.mixinOutputSlot
      );
      const currentValueBeforeCompose = getDeclValue(currentNode);
      const hasMergeValueContainer = assign === '&_:'
        ? isNode(currentValueBeforeCompose, N.Sequence)
        : isNode(currentValueBeforeCompose, N.List);
      const rawIncrementValue = node.options.normalizedAssignmentInput;
      const currentIncrementValue = rawIncrementValue
        && currentValueBeforeCompose
        && (!rawIncrementValue.hasFlag(F_STATIC) || containsReference(rawIncrementValue))
        ? currentValueBeforeCompose
        : rawIncrementValue;
      const shouldComposeMergedChain = Boolean(
        prior
        && (!crossesMixinOutputBoundary || currentIncrementValue)
        && (needsCrossScopeCompose || hasMergeValueContainer || currentIncrementValue)
      );
      if (priorAccumulatedValue && needsCrossScopeCompose && shouldComposeMergedChain) {
        currentNode = inlineCrossScopeMergedLeadingReference(currentNode, priorAccumulatedValue, assign, ownerRules);
      }
      if (prior && shouldComposeMergedChain) {
        const composed = composeMergedValue(
          currentNode,
          ownerRules,
          prior.node,
          assign,
          priorAccumulatedValue,
          currentIncrementValue
        );
        currentAccumulatedValue = composed?.value ?? currentAccumulatedValue;
        currentNode = composed?.node ?? currentNode;
      }
      const currentValue = getDeclValue(currentNode);
      currentAccumulatedValue ??= currentIncrementValue ?? currentValue;

      const occurrence = { node: currentNode, ownerRules };
      if (existingAnchor && isNode(existingAnchor.node, N.Declaration)) {
        const anchorIsSameOccurrence = existingAnchor.node === currentNode
          && existingAnchor.ownerRules === ownerRules;
        if (!anchorIsSameOccurrence) {
          hideMergedAnchor(existingAnchor, currentNode);
          mergedAnchorByName.set(name, occurrence);
          if (currentAccumulatedValue) {
            accumulatedValueByName.set(name, currentAccumulatedValue);
          }
          if (currentNode.visible) {
            lastVisibleByName.set(name, occurrence);
          }
          return;
        }
      }

      mergedAnchorByName.set(name, occurrence);
      if (currentAccumulatedValue) {
        accumulatedValueByName.set(name, currentAccumulatedValue);
      }
      if (currentNode.visible) {
        lastVisibleByName.set(name, occurrence);
      }
    };
    const walkMergedDeclarations = (node: Node, ownerRules: Rules): void => {
      if (isNode(node, N.Declaration)) {
        processDeclarationOccurrence(node, ownerRules);
        return;
      }
      if (!isNode(node, N.Rules)) {
        return;
      }
      for (let i = 0; i < node.rules.length; i++) {
        walkMergedDeclarations(node.rules[i]!, node);
      }
    };

    for (const node of rules.rules) {
      walkMergedDeclarations(node, rules);
    }
  }

  /**
   * Normalize call-produced declaration-only Rules ordering so declarations
   * emitted from late-evaluated calls (e.g. each/$for) appear before nested
   * rulesets/at-rules in the same parent Rules container.
   *
   * This runs after source-order evaluation to avoid mutating rule indices
   * mid-eval.
   */
  private _normalizeCallDeclarationRulesOrder(rules: Rules): void {
    let firstNestedIdx = -1;
    for (let i = 0; i < rules.rules.length; i++) {
      if (isNode(rules.rules[i]!, N.Ruleset | N.AtRule)) {
        firstNestedIdx = i;
        break;
      }
    }
    if (firstNestedIdx < 0) {
      return;
    }
    const shouldMove = (n: Node) => {
      if (
        !isNode(n, N.Rules)
        || n.options?.callDeclarationOutput !== true
        || n.rules.length === 0
      ) {
        return false;
      }
      for (let i = 0; i < n.rules.length; i++) {
        const child = n.rules[i]!;
        if (!isNode(child, N.Declaration) && !isNode(child, N.Comment)) {
          return false;
        }
      }
      return true;
    };
    const moved: Node[] = [];
    const remainder: Node[] = [];
    for (let i = firstNestedIdx; i < rules.rules.length; i++) {
      const node = rules.rules[i]!;
      if (shouldMove(node)) {
        moved.push(node);
      } else {
        remainder.push(node);
      }
    }
    if (moved.length === 0) {
      return;
    }
    const reordered: Node[] = new Array(rules.rules.length);
    let write = 0;
    for (let i = 0; i < firstNestedIdx; i++) {
      reordered[write++] = rules.rules[i]!;
    }
    for (let i = 0; i < moved.length; i++) {
      reordered[write++] = moved[i]!;
    }
    for (let i = 0; i < remainder.length; i++) {
      reordered[write++] = remainder[i]!;
    }
    for (let i = 0; i < reordered.length; i++) {
      rules.rules[i] = reordered[i]!;
    }
  }

  /**
   * After registration prep: ensure root on extend stack, then evaluate
   * children in source order.
   */
  private _evalAfterRegistrationPrep(rules: Rules, context: Context): MaybePromise<{ rules: Rules; rulesToHoist: boolean }> {
    this._ensureRootExtendStack(rules, context);
    if (rules.evaluated) {
      return { rules, rulesToHoist: false };
    }
    this._assignRootDocumentOrder(rules, context);
    const maybeHoist = this._evaluateSourceOrder(rules, context);
    if (isThenable(maybeHoist)) {
      return (maybeHoist as Promise<boolean>).then(rulesToHoist =>
        this._finishSourceOrderEvaluation(rules, rulesToHoist)
      );
    }
    return this._finishSourceOrderEvaluation(rules, maybeHoist as boolean);
  }

  private _finishSourceOrderEvaluation(rules: Rules, rulesToHoist: boolean): { rules: Rules; rulesToHoist: boolean } {
    this._normalizeCallDeclarationRulesOrder(rules);
    this._coalesceMergedDeclarations(rules);
    return {
      rules,
      rulesToHoist
    };
  }

  /** @internal */
  coalesceGeneratedControlOutput(): void {
    if (
      this._generatedControlOutputCoalesced
      || this.options.generatedControlOutput !== true
    ) {
      return;
    }
    this._generatedControlOutputCoalesced = true;
    this._coalesceMergedDeclarations(this);
  }

  private _checkReadonlyImportShadows(rules: Rules): void {
    // After all evaluation stages, direct variables in the current Rules cannot
    // shadow readonly variables imported into the same scope.
    const childEntries = rules.collectDirectDeclarationChildEntries();
    if (!childEntries?.length) {
      return;
    }
    const currentRules = rules.rules;
    for (const entry of childEntries) {
      if (!entry.readonly) {
        continue;
      }
      const importedRules = entry.node.rules;
      for (let i = 0; i < importedRules.length; i++) {
        const importedDecl = importedRules[i]!;
        if (!isNode(importedDecl, N.VarDeclaration)) {
          continue;
        }
        const key = String(importedDecl.name.valueOf());
        for (let j = 0; j < currentRules.length; j++) {
          const currentDecl = currentRules[j]!;
          if (
            isNode(currentDecl, N.VarDeclaration)
            && !currentDecl.options?.setDefined
            && String(currentDecl.name.valueOf()) === key
          ) {
            throw new ReferenceError(`"${key}" is readonly`);
          }
        }
      }
    }
  }

  private _ensureRootExtendStack(rules: Rules, context: Context): void {
    if (rules !== context.root || context.extendRoots.extendRootStack.length !== 0) {
      return;
    }
    if (!context.extendRoots.root) {
      context.extendRoots.registerRoot(rules);
    }
    context.extendRoots.pushExtendRoot(rules);
  }

  private _assignRootDocumentOrder(rules: Rules, context: Context): void {
    if (rules !== context.root) {
      return;
    }
    const map = new WeakMap<Ruleset, number>();
    context.documentOrderByRuleset = map;
    this._assignDocumentOrderDepthFirst(rules, map, { value: 0 });
  }

  private _prepareForEval(context: Context): MaybePromise<{ rules: Rules; rulesToHoist: boolean }> {
    this._setupContextForRules(context, this);
    const rulesAfterPrep = this._prepareRegistrationForEval(context);
    if (isThenable(rulesAfterPrep)) {
      return (rulesAfterPrep as Promise<Rules>).then(rules =>
        this._evalPreparedRules(rules, context)
      );
    }
    return this._evalPreparedRules(rulesAfterPrep as Rules, context);
  }

  private _evalPreparedRules(rules: Rules, context: Context): MaybePromise<{ rules: Rules; rulesToHoist: boolean }> {
    this._setupContextForRules(context, rules);
    // When we're the outermost Rules, use the tree we're evaling as root
    // (may differ from context.root set in getTree, or be a prepared wrapper).
    if (context.rulesEvalStack.length === 1) {
      context.root = rules;
    }
    return this._evalAfterRegistrationPrep(rules, context);
  }

  private _prepareRegistrationForEval(context: Context): MaybePromise<Rules> {
    if (this.registrationPrepared) {
      if (!this._registrationPrepared) {
        return this._prepareRegistrationOnce(context);
      }
      return this;
    }
    // Eval owns registration prep. This step establishes lookup identities
    // before the source-order eval walk without evaluating rule bodies.
    const result = this._prepareRegistrationOnce(context);
    return isThenable(result) ? (result as Promise<Rules>) : result;
  }

  private _createRegistrationPrepState(): RegistrationPrepState {
    return {
      declarationNames: {
        nodes: [],
        resolvedNodes: []
      },
      orderedIdentity: {
        nodes: [],
        resolvedNodes: []
      }
    };
  }

  private _finishEval(
    rules: Rules,
    context: Context,
    saved: ReturnType<Rules['_snapshotContext']>
  ): Rules {
    // Rulesets from imported Rules are already registered to their own treeRoot
    // during registration prep. The extend search loops through allRoots
    // directly via extend-roots' per-root ruleset sets.
    this._checkReadonlyImportShadows(rules);

    // Extends run once the true outermost root has finished evaluating.
    const isOutermost = rules === context.root;
    if (isOutermost) {
      processExtends(context);
    }

    context.rulesContext = saved.rulesContext;
    // Keep outermost roots in context so extends evaluated during selector
    // evaluation can still access the correct treeRoot/root.
    if (saved.treeRoot !== undefined && !isOutermost) {
      context.treeRoot = saved.treeRoot;
    }
    if (saved.root !== undefined && !isOutermost) {
      context.root = saved.root;
    }
    if (!isOutermost) {
      this._popExtendRootStackTo(context, saved);
    }
    if (rules === context.root) {
      context.extendRoots.popExtendRoot();
    }
    context.rulesEvalStack.pop();
    context.depth--;
    return rules;
  }

  private _restoreEvalAfterError(context: Context, saved: ReturnType<Rules['_snapshotContext']>): void {
    context.rulesContext = saved.rulesContext;
    if (saved.treeRoot !== undefined) {
      context.treeRoot = saved.treeRoot;
    }
    if (saved.root !== undefined) {
      context.root = saved.root;
    }
    this._popExtendRootStackTo(context, saved);
    if (context.rulesEvalStack[context.rulesEvalStack.length - 1] === sourceRulesOf(this)) {
      context.rulesEvalStack.pop();
    }
    context.depth--;
  }

  override evalNode(context: Context): MaybePromise<Rules> {
    const saved = this._snapshotContext(context);
    context.rulesEvalStack.push(sourceRulesOf(this));
    const isSourceBackedCallableEval = this.options.sourceBackedCallableSurface === true;
    if (isSourceBackedCallableEval) {
      context.sourceBackedCallableEvalDepth++;
    }
    let result: MaybePromise<{ rules: Rules; rulesToHoist: boolean }>;
    try {
      result = this._prepareForEval(context);
    } catch (error) {
      if (isSourceBackedCallableEval) {
        context.sourceBackedCallableEvalDepth--;
      }
      this._restoreEvalAfterError(context, saved);
      throw error;
    }
    const finish = ({ rules }: { rules: Rules; rulesToHoist: boolean }): Rules => {
      if (isSourceBackedCallableEval) {
        context.sourceBackedCallableEvalDepth--;
      }
      return this._finishEval(rules, context, saved);
    };
    if (isThenable(result)) {
      return result.then(
        finish,
        (error) => {
          if (isSourceBackedCallableEval) {
            context.sourceBackedCallableEvalDepth--;
          }
          this._restoreEvalAfterError(context, saved);
          throw error;
        }
      );
    }
    return finish(result);
  }

  override resolve(context: Context): MaybePromise<Node> {
    if (this.evaluated || this.hasFlag(F_STATIC)) {
      return this;
    }
    if (this.registrationPrepared) {
      return this.eval(context);
    }
    const output = this.eval(context);
    const toState = (rules: Rules): RulesResolveState => createRulesResolveState(this, rules);
    const state = isThenable(output)
      ? output.then(toState)
      : toState(output);
    return isThenable(state)
      ? state.then(resolved => resolved.output)
      : state.output;
  }
}

export const rules = defineType(Rules, 'Rules');

// Registration prep has two pending lanes. Declaration-name nodes own a local
// fixed-point state because one declaration name can unblock another; every
// other unresolved identity stays in one source-ordered lane for now.
type RegistrationPrepState = {
  declarationNames: PendingDeclarationNamePrepState;
  orderedIdentity: PendingOrderedIdentityPrepState;
};

type PendingDeclarationNamePrepState = {
  nodes: Node[];
  resolvedNodes: Node[];
};

type PendingOrderedIdentityPrepState = {
  nodes: Node[];
  resolvedNodes: Node[];
};

// const TypeToNodeType = new Map([
//   ['Mixin', NodeType.MIXIN],
//   ['Ruleset', NodeType.RULESET],
//   ['Declaration', NodeType.PROPERTY],
//   ['VarDeclaration', NodeType.VARIABLE],
//   ['Rules', NodeType.RULES]
// ])

// export const enum NodeTypeIndex {
//   NONE             = 0b000000,
//   MIXIN            = 0b000001,
//   RULESET          = 0b000010,
//   MIXIN_OR_RULESET = 0b000011,
//   PROPERTY         = 0b000100,
//   VARIABLE         = 0b001000,
//   VAR_OR_PROP      = 0b001100,
//   /**
//    * Variables and mixins can leak
//   */
//   LEAKY_RULES      = 0b010000,
//   /** @note - Properties and rulesets are always visible. */
//   PRIVATE_RULES    = 0b100000,
//   RULES            = 0b110000
// }

// type IndexKey = `${NodeType}${string}`

/**
 * Right now, the only nodes that can be registered to the scope for lookups
 */
// type ScopeNodes = Declaration | VarDeclaration | Mixin | Ruleset | Rules
function callableEntryHasNoRequiredParams(entry: MixinEntry): boolean {
  const params = isCallableEntry(entry)
    ? getCallableEntryParams(entry)
    : undefined;
  if (!params || params.length === 0) {
    return true;
  }
  for (const param of params.items) {
    if (param.type === 'Rest') {
      continue;
    }
    if (isNode(param, N.VarDeclaration)) {
      if (param.valueNode instanceof Nil) {
        return false;
      }
      continue;
    }
    if (isNode(param, N.Any) && param.role === 'property') {
      return false;
    }
    return false;
  }
  return true;
}
