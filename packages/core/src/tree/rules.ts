import { setSourceSpan, spanStartOf, spanEndOf, sourceSpanOf } from './util/provenance.js';
import {
  Node,
  defineType,
  type NodeOptions,
  type LocationInfo,
  type TreeContext,
  F_ALLOW_ROOT,
  F_STATIC,
  F_VISIBLE,
  F_MERGE_SUPPRESSED
} from './node.js';
import { Context } from '../context.js';
import { ERR } from '../jess-error.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { type Ruleset } from './ruleset.js';
import { type Mixin } from './mixin.js';
import type { Selector } from './selector.js';
import { spaced, Sequence } from './sequence.js';
import {
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
import { isSpineEligibleRoot, renderRootViaSpine, SPINE_ABORT_TO_EVAL, isSpineFoldableImport, isSpineFoldableImportBody, isSpineFoldableCssImportStatement, assignSpineChildIndices, spineImportDedupeVerdict, withSpineMultipleScope, isSpineEligibleMixinCall, resolveSpineMixinCall, isSpineFoldableStatementCall } from './util/emit-walk.js';
import type { SpineMixinCallResolution } from './util/emit-walk.js';
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
  hasPrintableTriviaAt,
  withSpineMergePlan,
  resolveSpineLeafText,
  resolveSpineStatementCallNode,
  serializeSpineStatementCallNode,
  evalIsolatingSpinePrintState
} from './util/serialize-helper.js';
import type { AtRule } from './at-rule.js';
import type { AtRuleStatement } from './at-rule-statement.js';
import type { StyleImport, SpineImportResolution } from './import-style.js';
import {
  buildScopeFrame,
  copyScopeFrameLiveBindingSlots,
  createVarDeclarationBindingEntry,
  injectFrameLeakBinding,
  linkImportFallbackFrame,
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
  writePreparedRenderTextResult,
  writeRenderTextResult
} from './util/render-buffer.js';
import type { JsFunction } from './js-function.js';
import type { Func } from './function.js';
import {
  blocksAmbientMixinOutputLookup,
  canEnterMixinOutputForLookup,
  canEnterRulesEntryForLookup,
  isOptionalRulesEntry,
  isPublicRulesEntry,
  type RulesEntryLike
} from './util/mixin-output-slot.js';
import type { MixinOutputSlot } from './util/mixin-output-slot.js';
import type { CallableLookupEntry, MixinEntry } from './util/callable-entry.js';
import { queueTopImport } from './util/import-queue.js';
import {
  findWritableSetDefinedDeclarationOccurrence,
  type DirectDeclarationOccurrence
} from './util/direct-rules-lookup.js';
import { checkValidNodes } from './util/check-valid-nodes.js';
const { isArray } = Array;
const EMPTY_CALLABLE_BUCKET: CallableLookupEntry[] = [];
const NESTABLE_AT_RULE_NAMES = new Set(['@media', '@supports', '@layer', '@container', '@scope']);
const MAX_DECLARATION_NAME_REGISTRATION_RETRIES = 5;
const SCOPE_FRAME_PROFILE_COUNTERS_KEY = '__JESS_SCOPE_FRAME_PROFILE_COUNTERS__';
const MERGE_PROFILE_COUNTERS_KEY = '__JESS_MERGE_PROFILE_COUNTERS__';
type ScopeFrameProfileGlobals = typeof globalThis & {
  [SCOPE_FRAME_PROFILE_COUNTERS_KEY]?: Record<string, number>;
  [MERGE_PROFILE_COUNTERS_KEY]?: Record<string, number>;
};
const scopeFrameProfileCounters = (globalThis as ScopeFrameProfileGlobals)[SCOPE_FRAME_PROFILE_COUNTERS_KEY];
const mergeProfileCounters = (globalThis as ScopeFrameProfileGlobals)[MERGE_PROFILE_COUNTERS_KEY];
const scopeFrameProfileNow = scopeFrameProfileCounters
  ? globalThis.performance?.now.bind(globalThis.performance)
  : undefined;
type PathResolutionError = Error & { _isPathResolutionError?: boolean };
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

const recordScopeFrameProfile = scopeFrameProfileCounters
  ? (event: 'cacheHit' | 'create', rules: Rules, frame: ScopeFrame, startedAt: number | undefined): void => {
      const counters = scopeFrameProfileCounters;
      const placement = rules.sourceNode instanceof Rules && rules.sourceNode !== rules;
      const placementKey = placement ? 'placement' : 'canonical';
      let depth = 0;
      let cursor: ScopeFrame | undefined = frame;
      while (cursor) {
        depth++;
        cursor = cursor.parent;
      }
      counters[`getScopeFrame.${event}`] = (counters[`getScopeFrame.${event}`] ?? 0) + 1;
      counters[`getScopeFrame.${event}.${placementKey}`] = (counters[`getScopeFrame.${event}.${placementKey}`] ?? 0) + 1;
      counters[`getScopeFrame.${event}.depth.${depth}`] = (counters[`getScopeFrame.${event}.depth.${depth}`] ?? 0) + 1;
      if (startedAt !== undefined) {
        counters[`getScopeFrame.${event}.ms`] = (counters[`getScopeFrame.${event}.ms`] ?? 0)
          + scopeFrameProfileNow!() - startedAt;
      }
    }
  : undefined;

const recordMergeProfile = mergeProfileCounters
  ? (event: 'admissionCalls' | 'admissionItemsVisited' | 'admittedCalls' | 'calls' | 'featureBearingContainers'): void => {
      mergeProfileCounters[event] = (mergeProfileCounters[event] ?? 0) + 1;
    }
  : undefined;

type ExactCallableFindOptions = {
  hasTarget?: boolean;
  local?: boolean;
  includeRulesets?: boolean;
  /**
   * Ruleset-only lookup: collect ONLY plain `Ruleset` candidates (`.foo {}`),
   * dropping `Mixin` (parametric/parens `.foo() {}`) and any other callable. Used
   * by Jess `$apply` and `*[…]` selector capture, whose semantics apply rulesets
   * as-is — never the args/guards callable machinery.
   */
  rulesetsOnly?: boolean;
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

/**
 * A variable-declaration that is an ASSIGNMENT to an existing binding, not a new
 * binding: `setDefined` (Sass `!global`) or `nearestOuter` (Jess `:=`). Neither
 * contributes a declaration/binding surface — they resolve and overwrite an
 * existing cell — so both are skipped everywhere a declaration would be indexed
 * as a fresh binding.
 */
function isBindingReassignment(node: Node): boolean {
  return node.options?.setDefined === true || node.options?.nearestOuter === true;
}

/**
 * Evaluate a setDefined assignment's right-hand side. The value is left lazy
 * when there is no eval context (registration-time assignment): it is a value
 * node that the binding cell holds and reads dereference later.
 */
function evalSetDefinedAssignedValue(node: Declaration, context?: Context): Node {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  let assignedValue = node.value as Node;
  if (context) {
    const evaluatedValue = assignedValue.eval(context);
    if (!isThenable(evaluatedValue)) {
      assignedValue = evaluatedValue;
    }
  }
  return assignedValue;
}

function isStyleImportRegistrationNode(node: Node): node is StyleImport {
  return node.type === 'StyleImport';
}

function isAtRuleStatementNode(node: Node): node is AtRuleStatement {
  return node.type === 'AtRuleStatement';
}

function isImportAtRule(node: Node): node is AtRule {
  return isNode(node, N.AtRule)
    && String(node.name.valueOf?.() ?? node.name ?? '').trim() === '@import';
}

// An evaluated import placement that dumps its members into the ENCLOSING scope:
// a plain `@import` (marked `importBoundary === false`) or a wildcard
// `@compose (namespace: *)` (marked `inlinesMembersToParent`, while it keeps
// `importBoundary === true` to still block the imported body from seeing parent vars).
function importInlinesMembersToParent(rules: Rules): boolean {
  return rules.options.importBoundary === false
    || rules.options.inlinesMembersToParent === true;
}

// Walk a frame's lexical parent chain to detect any per-call live-binding scope
// (mixin params / loop vars). Used to distinguish a genuinely re-usable mixin body
// child (whose per-call output must not be baked into the shared template) from a
// nested ruleset/@media body re-used only for selector nesting (whose output is
// invariant across evals). Bounded + cycle-guarded like the other frame walks.
function frameChainHasLiveBindings(frame: ScopeFrame | undefined): boolean {
  let f = frame;
  const seen = new Set<ScopeFrame>();
  while (f && !seen.has(f)) {
    if (f.hasLiveBindings) {
      return true;
    }
    seen.add(f);
    f = f.parent;
  }
  return false;
}

// A callable's per-call surface adopted under a mixin-output namespace member
// (e.g. `.sayGender` bound under the output `.person` for `.person.sayGender()`)
// resolves free vars up that DEFINITION member, not the call site. The member is
// a RETAINED per-call output frame: its scope-frame parent carries the call's
// live param slots (hasLiveBindings). Distinct from the placement scope, so the
// §4 placement re-point must leave the definition parent intact.
function isRetainedOutputDefinitionParent(
  parent: Node | undefined,
  enclosingScope: Rules | undefined
): boolean {
  if (!isNode(parent, N.Rules) || parent === enclosingScope) {
    return false;
  }
  const frame = (parent as Rules).getScopeFrame();
  // The hasLiveBindings-parent signal alone is too broad: an ordinary nested
  // ruleset inside a mixin body (e.g. a doubly-nested `.innest` inside `.inner`)
  // also chains to the call's param slots, yet it is NOT a retained output — its
  // per-call placement re-point must still fire so a second call rebinds its free
  // vars to the new call's slots instead of resolving through the first call's
  // cached frame chain.
  //
  // A retained mixin-output member OWNS its frame (`frame.rulesNode === parent`). A
  // per-call re-evaluated body child is COW-derived during eval, which re-points its
  // frame's `rulesNode` to the derived output surface (`frame.rulesNode !== parent`)
  // — the marker that it is a placed body, not a retained definition. Require frame
  // ownership so only the genuine retained-output parent suppresses the re-point.
  return frame.parent?.hasLiveBindings === true
    && frame.rulesNode === parent;
}

function keysStartWith(keys: readonly string[], path: readonly string[], pathStart = 0): boolean {
  if (keys.length > path.length - pathStart) {
    return false;
  }
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== path[pathStart + i]) {
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

// Combinators are string leaves between selector segments; a compound namespace
// key like `#theme>.button` (or `#theme .button`) concatenates them without
// spaces, so each segment slice must drop any trailing combinator characters.
function isCombinatorCharCode(char: number): boolean {
  // ' ' | '>' | '+' | '~' | '|'
  return char === 32 || char === 62 || char === 43 || char === 126 || char === 124;
}

// Split a `#`/`.`-delimited selector string into its ordered segment keys,
// dropping trailing combinator characters from each segment (`#theme>.button`
// → ['#theme', '.button']). Returns [] for strings with no class/id segment.
function splitSelectorStringKeys(key: string): string[] {
  const out: string[] = [];
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
    let end = i;
    while (end > start + 1 && isCombinatorCharCode(key.charCodeAt(end - 1))) {
      end--;
    }
    i--;
    if (end === start + 1) {
      continue;
    }
    out.push(key.slice(start, end));
  }
  return out;
}

function splitStaticCallablePathKey(key: string): string[] | undefined {
  const keys = splitSelectorStringKeys(key);
  return keys.length > 1 ? keys : undefined;
}

function isSelectorLikeNode(node: unknown): node is Selector {
  return isNode(node, N.Selector) || (isNode(node) && node.type === 'InterpolatedSelector');
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
  const prepared = prepareBufferPrintState(context, options, buffer);
  const mark = prepared.writer.mark();
  const text = node instanceof Rules && !directSourceRender
    ? (
        node === context.root || source === context.root
          ? node._toDocumentString(prepared)
          : node.toString(prepared)
      )
    : renderRulesToPreparedString(source, node, context, prepared, directSourceRender);
  return writePreparedRenderTextResult(buffer, prepared, mark, text);
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
  if ((isNode(node, N.Ruleset) || isNode(node, N.AtRule) || isNode(node, N.Mixin)) && node instanceof Rules) {
    return node;
  }
  if (isNode(node, N.Rules)) {
    return node;
  }
  return undefined;
}

function childCallableRulesOf(node: Node): Rules | undefined {
  if ((isNode(node, N.Ruleset) || isNode(node, N.AtRule)) && node instanceof Rules) {
    return node;
  }
  if (isNode(node, N.Rules)) {
    return node;
  }
  return undefined;
}

function rulesMayContainExactCallableSurface(rules: Rules): boolean {
  const value = rules.rules;
  for (let i = 0; i < value.length; i++) {
    const node = value[i]!;
    if (isNode(node, N.Mixin | N.Ruleset | N.AtRule | N.Rules)) {
      return true;
    }
  }
  return false;
}

function rulesMayContainExactMixinSurface(rules: Rules): boolean {
  if (rules.hasExactMixinChildSurface) {
    return true;
  }
  const value = rules.rules;
  for (let i = 0; i < value.length; i++) {
    const node = value[i]!;
    if (isNode(node, N.Mixin)) {
      return true;
    }
    const child = childCallableRulesOf(node);
    if (child && rulesMayContainExactMixinSurface(child)) {
      return true;
    }
  }
  return false;
}

function rulesMayContainExactRulesetSurface(rules: Rules): boolean {
  if (rules.hasExactRulesetChildSurface) {
    return true;
  }
  const value = rules.rules;
  for (let i = 0; i < value.length; i++) {
    const node = value[i]!;
    if (isNode(node, N.Ruleset)) {
      return true;
    }
    const child = childCallableRulesOf(node);
    if (child && rulesMayContainExactRulesetSurface(child)) {
      return true;
    }
  }
  return false;
}

function rulesMayContainDeclarationSurface(rules: Rules): boolean {
  if (rules.hasDeclarationChildSurface) {
    return true;
  }
  const value = rules.rules;
  for (let i = 0; i < value.length; i++) {
    const node = value[i]!;
    if (isNode(node, N.Declaration) && !isNode(node, N.VarDeclaration) && !isBindingReassignment(node)) {
      return true;
    }
    const child = childRulesOf(node);
    if (child && rulesMayContainDeclarationSurface(child)) {
      return true;
    }
  }
  return false;
}

export function hasCarriedMergeOutputSurface(node: Node): boolean {
  if (isNode(node, N.Declaration)) {
    const assign = node.options.normalizedFromAssign;
    return assign === '+:' || assign === '&,:' || assign === '&_:';
  }
  if (!(node instanceof Rules)) {
    return false;
  }
  // Mixin and Ruleset bodies are definition boundaries. Their own bit is used
  // when that body is evaluated, but it must not make a source-scope admission
  // look through the definition and coalesce declarations that have not been
  // emitted into this surface. Callable output is represented by a plain Rules
  // placement surface (or an If/For/While output surface), whose bit is carried.
  if (node.type === 'Mixin' || node.type === 'Ruleset' || node.type === 'AtRule') {
    return false;
  }
  return node.hasMergeOutputSurface;
}

function hasMergeOutputSurface(rules: Rules): boolean {
  recordMergeProfile?.('admissionCalls');
  if (rules.hasMergeOutputSurface) {
    recordMergeProfile?.('featureBearingContainers');
    return true;
  }
  return false;
}

function rulesMayContainVarDeclarationSurface(rules: Rules): boolean {
  if (rules.hasVarDeclarationChildSurface) {
    return true;
  }
  const value = rules.rules;
  for (let i = 0; i < value.length; i++) {
    const node = value[i]!;
    if (isNode(node, N.VarDeclaration) && !isBindingReassignment(node)) {
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
  if (rulesHasCarriedReferenceImportSurface(rules)) {
    return true;
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
  return false;
}

function rulesHasCarriedReferenceImportSurface(rules: Rules): boolean {
  return (
    rules.options.referenceMode === true
    || rules._hasReferenceImports
    || rules.hasReferenceImportChildSurface
  );
}

function sourceRulesOf(rules: Rules): Rules {
  // A canonical body may be any Rules subclass (Mixin/Ruleset) now that the
  // Mixin.sourceNode wrapper is gone — `instanceof Rules` covers all three.
  return rules.sourceNode instanceof Rules ? rules.sourceNode : rules;
}

function isStyleImportPathResolutionError(error: unknown): boolean {
  return error instanceof Error && (error as PathResolutionError)._isPathResolutionError === true;
}

function hasStaticNameMethod(value: unknown): value is { hasStaticName(): boolean } {
  return typeof value === 'object'
    && value !== null
    && 'hasStaticName' in value
    && typeof (value as { hasStaticName?: unknown }).hasStaticName === 'function';
}

function consumeLeadingTrivia(node: Node, options: PrintOptions): string {
  const trivia = (options.trivia ?? node.sourceRoot?._treeContext?.opts?.trivia) as
    | TreeContext['opts']['trivia']
    | undefined;
  if (trivia && options.trivia !== trivia) {
    options.trivia = trivia;
  }
  const offset = spanStartOf(node);
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
  const resolved = getPrintOptions(options);
  const writer = resolved.writer;
  const mark = writer.mark();
  fn(resolved);
  const frag = writer.getSince(mark);
  writer.restore(mark);
  return frag;
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
  /**
   * Marks declaration-only Rules emitted from non-mixin call sites so post-eval
   * ordering can move them ahead of nested rulesets/at-rules without relying on
   * a live call-site back-pointer on the emitted Rules wrapper.
   */
  callDeclarationOutput?: boolean;
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
  /**
   * This import placement dumps its members into the ENCLOSING scope as if written
   * in place: a plain `@import`, or a `@compose (namespace: *)` wildcard. Distinct
   * from `importBoundary` (which blocks the imported body from seeing PARENT vars —
   * the opposite direction): a wildcard compose both blocks upward AND inlines down.
   * The enclosing ScopeFrame links such a placement's frame as a fallback.
   */
  inlinesMembersToParent?: boolean;
  /** Render gating marker for referenced imports/usages (serializer-time only). */
  referenceMode?: boolean;
};

export interface Rules<V = never, O extends NodeOptions = RulesOptions & NodeOptions> extends Node<V, O> {
  get options(): O & NodeOptions & {
    rulesVisibility: Record<string, RulesVisibility>;
  };
  set options(value: O & NodeOptions);
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
  includeRulesets: boolean,
  rulesetsOnly = false
): MixinEntry[] | undefined {
  let results: MixinEntry[] | undefined;
  for (let i = bucket.length - 1; i >= 0; i--) {
    const entry = bucket[i]!;
    if (entry.match.length !== 0) {
      continue;
    }
    const candidate = entry.value;
    if (!includeRulesets && isNode(candidate, N.Ruleset)) {
      continue;
    }
    // Ruleset-only (bracket capture `*[.foo]()`): drop non-Ruleset callables.
    if (rulesetsOnly && !isNode(candidate, N.Ruleset)) {
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
  offset: number,
  rulesetsOnly = false
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
    if (rulesetsOnly && !isNode(candidate, N.Ruleset)) {
      continue;
    }
    (results ??= []).push(candidate);
  }
  return results;
}

function collectCallableBucketRulesetPrefixMatches(
  bucket: CallableLookupEntry[],
  path: readonly string[],
  offset: number,
  scope: Rules
): CallableRulesetPrefixMatch[] | undefined {
  const remainingLength = path.length - offset;
  if (remainingLength <= 1) {
    return undefined;
  }
  let results: CallableRulesetPrefixMatch[] | undefined;
  for (let i = bucket.length - 1; i >= 0; i--) {
    const entry = bucket[i]!;
    if (!isNode(entry.value, N.Ruleset)) {
      continue;
    }
    const consumedLength = entry.match.length + 1;
    if (consumedLength >= remainingLength) {
      continue;
    }
    let matchesPath = true;
    for (let matchIndex = 0; matchIndex < entry.match.length; matchIndex++) {
      if (entry.match[matchIndex] !== path[offset + matchIndex + 1]) {
        matchesPath = false;
        break;
      }
    }
    if (!matchesPath) {
      continue;
    }
    (results ??= []).push({
      ruleset: entry.value,
      consumed: entry.match.length === 0 ? [path[offset]!] : [path[offset]!, ...entry.match],
      scope
    });
  }
  return results;
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
// Rules-only packed flags (see `rulesFlags`). A Rules-private int, distinct from
// the base `flags` bitmask that every leaf node shares — keeps leaf reads narrow.
const R_HAS_DIRECT_CHILD_RULE_SURFACE = 1 << 0;
const R_HAS_DECLARATION_CHILD_SURFACE = 1 << 1;
const R_HAS_VAR_DECLARATION_CHILD_SURFACE = 1 << 2;
const R_HAS_REFERENCE_IMPORT_CHILD_SURFACE = 1 << 3;
const R_HAS_EXACT_CALLABLE_CHILD_SURFACE = 1 << 4;
const R_HAS_EXACT_MIXIN_CHILD_SURFACE = 1 << 5;
const R_HAS_EXACT_RULESET_CHILD_SURFACE = 1 << 6;
const R_HAS_MERGE_OUTPUT_SURFACE = 1 << 12;
const R_BODY_EVALUATED = 1 << 7;
const R_HAS_EXTENDS = 1 << 8;
const R_HAS_REFERENCE_IMPORTS = 1 << 9;
const R_REGISTRATION_PREPARED = 1 << 10;
const R_PLACEMENT_REPOINTED = 1 << 11;
/** Bits reset by `resetDerivedState` (child-derived surfaces + extend/reference-import). */
const R_DERIVED_STATE_MASK =
  R_HAS_DIRECT_CHILD_RULE_SURFACE
  | R_HAS_DECLARATION_CHILD_SURFACE
  | R_HAS_VAR_DECLARATION_CHILD_SURFACE
  | R_HAS_REFERENCE_IMPORT_CHILD_SURFACE
  | R_HAS_EXACT_CALLABLE_CHILD_SURFACE
  | R_HAS_EXACT_MIXIN_CHILD_SURFACE
  | R_HAS_EXACT_RULESET_CHILD_SURFACE
  | R_HAS_MERGE_OUTPUT_SURFACE
  | R_HAS_EXTENDS
  | R_HAS_REFERENCE_IMPORTS;

/**
 * Cold, rarely-allocated callable/function/child-rule lookup state, moved OFF the
 * per-instance `Rules` shape into one lazily-allocated fixed-shape struct. A leaf
 * declaration-only Ruleset (the majority of the ~12k instances) never runs a
 * multi-kind lookup, so it carries ONE `undefined` `_lookup` slot instead of the
 * ~12 fields below. Only a WRITE allocates the struct; reads see `undefined` and
 * fall back to the neutral value (undefined map / `0` version).
 *
 * FAST-V8: every field is declared up-front so V8 keeps a single monomorphic
 * hidden class. No dynamic attach / `Object.assign` / `defineProperty` / `delete`.
 */
class RulesLookupState {
  varsByName: Map<string, BindingEntry[]> | undefined = undefined;
  functionsByName: Map<string, JsFunction | Func> | undefined = undefined;
  callableLookupCache: Map<string, CallableLookupEntry[] | null> | undefined = undefined;
  /**
   * Full callable index for this scope: every callable key -> its ordered entries,
   * built in ONE pass over `rules` and memoized. `getCallableEntriesForKey` reads a
   * key out of this instead of re-scanning every rule per distinct key. Invalidated
   * alongside `callableLookupCache` when the scope's callable set changes.
   */
  callableFullIndex: Map<string, CallableLookupEntry[]> | undefined = undefined;
  directChildRuleEntries: Array<RulesEntryLike> | null | undefined = undefined;
  directDeclarationChildEntries: Array<RulesEntryLike> | null | undefined = undefined;
  directDeclarationsByName: Map<string, Declaration[] | null> | undefined = undefined;
  directDeclarationLookupCache: Map<string, {
    readonly optionalMatch: DirectDeclarationOccurrence | undefined;
    readonly publicMatch: DirectDeclarationOccurrence | undefined;
    readonly readonly: boolean;
  }> | undefined = undefined;

  declarationLookupVersionsByName: Map<string, number> | undefined = undefined;
  functionLookupVersionsByName: Map<string, number> | undefined = undefined;
  _closureScope: Rules | undefined = undefined;
  callableLookupVersion = 0;
  functionLookupVersion = 0;
  declarationLookupVersion = 0;
  lookupVersion = 0;
}

export class Rules<V = never, O extends NodeOptions = RulesOptions & NodeOptions> extends Node<V, O> {
  static override childKeys: readonly string[] = ['rules'] as const;

  readonly rules: Node[];

  /**
   * The per-source-tree context (file, options, source-map state). A Rules-only
   * field: every node's authoritative context resolves via
   * `sourceRoot?._treeContext`, and only Rules nodes are a `sourceRoot`, so the
   * ~39k non-Rules nodes no longer carry this slot. Set in the ctor and
   * maintained by `inherit`/`detachTrivia` (both Rules-guarded on the base).
   */
  _treeContext: TreeContext | undefined;

  /** Fast map: var name -> ordered static VarDeclaration binding entries in this scope. */
  get varsByName(): Map<string, BindingEntry[]> | undefined {
    return this._lookup?.varsByName;
  }

  set varsByName(value: Map<string, BindingEntry[]> | undefined) {
    this.ensureLookup().varsByName = value;
  }

  /**
   * Cold callable/function/child-rule lookup state (see `RulesLookupState`). One
   * slot instead of ~12 eager fields; lazily allocated on first WRITE by
   * `ensureLookup()`. Reads go through the property getters below (never allocate).
   */
  private _lookup: RulesLookupState | undefined = undefined;

  private ensureLookup(): RulesLookupState {
    return this._lookup ??= new RulesLookupState();
  }

  get functionsByName(): Map<string, JsFunction | Func> | undefined {
    return this._lookup?.functionsByName;
  }

  set functionsByName(value: Map<string, JsFunction | Func> | undefined) {
    this.ensureLookup().functionsByName = value;
  }

  get callableLookupCache(): Map<string, CallableLookupEntry[] | null> | undefined {
    return this._lookup?.callableLookupCache;
  }

  set callableLookupCache(value: Map<string, CallableLookupEntry[] | null> | undefined) {
    this.ensureLookup().callableLookupCache = value;
  }

  get directChildRuleEntries(): Array<RulesEntryLike> | null | undefined {
    return this._lookup?.directChildRuleEntries;
  }

  set directChildRuleEntries(value: Array<RulesEntryLike> | null | undefined) {
    this.ensureLookup().directChildRuleEntries = value;
  }

  get directDeclarationChildEntries(): Array<RulesEntryLike> | null | undefined {
    return this._lookup?.directDeclarationChildEntries;
  }

  set directDeclarationChildEntries(value: Array<RulesEntryLike> | null | undefined) {
    this.ensureLookup().directDeclarationChildEntries = value;
  }

  /**
   * Rules-only packed boolean state (12 formerly-per-instance booleans). One int
   * slot instead of eleven `false`/`false`… fields keeps the Rules shape narrow
   * (~12k instances). Backed by the `R_*` bits above; each boolean keeps its
   * original name via a get/set pair so all call sites are unchanged.
   */
  private rulesFlags = 0;

  get hasDirectChildRuleSurface(): boolean {
    return (this.rulesFlags & R_HAS_DIRECT_CHILD_RULE_SURFACE) !== 0;
  }

  set hasDirectChildRuleSurface(value: boolean) {
    if (value) {
      this.rulesFlags |= R_HAS_DIRECT_CHILD_RULE_SURFACE;
    } else {
      this.rulesFlags &= ~R_HAS_DIRECT_CHILD_RULE_SURFACE;
    }
  }

  get hasDeclarationChildSurface(): boolean {
    return (this.rulesFlags & R_HAS_DECLARATION_CHILD_SURFACE) !== 0;
  }

  set hasDeclarationChildSurface(value: boolean) {
    if (value) {
      this.rulesFlags |= R_HAS_DECLARATION_CHILD_SURFACE;
    } else {
      this.rulesFlags &= ~R_HAS_DECLARATION_CHILD_SURFACE;
    }
  }

  get hasVarDeclarationChildSurface(): boolean {
    return (this.rulesFlags & R_HAS_VAR_DECLARATION_CHILD_SURFACE) !== 0;
  }

  set hasVarDeclarationChildSurface(value: boolean) {
    if (value) {
      this.rulesFlags |= R_HAS_VAR_DECLARATION_CHILD_SURFACE;
    } else {
      this.rulesFlags &= ~R_HAS_VAR_DECLARATION_CHILD_SURFACE;
    }
  }

  get hasReferenceImportChildSurface(): boolean {
    return (this.rulesFlags & R_HAS_REFERENCE_IMPORT_CHILD_SURFACE) !== 0;
  }

  set hasReferenceImportChildSurface(value: boolean) {
    if (value) {
      this.rulesFlags |= R_HAS_REFERENCE_IMPORT_CHILD_SURFACE;
    } else {
      this.rulesFlags &= ~R_HAS_REFERENCE_IMPORT_CHILD_SURFACE;
    }
  }

  get hasExactCallableChildSurface(): boolean {
    return (this.rulesFlags & R_HAS_EXACT_CALLABLE_CHILD_SURFACE) !== 0;
  }

  set hasExactCallableChildSurface(value: boolean) {
    if (value) {
      this.rulesFlags |= R_HAS_EXACT_CALLABLE_CHILD_SURFACE;
    } else {
      this.rulesFlags &= ~R_HAS_EXACT_CALLABLE_CHILD_SURFACE;
    }
  }

  get hasExactMixinChildSurface(): boolean {
    return (this.rulesFlags & R_HAS_EXACT_MIXIN_CHILD_SURFACE) !== 0;
  }

  set hasExactMixinChildSurface(value: boolean) {
    if (value) {
      this.rulesFlags |= R_HAS_EXACT_MIXIN_CHILD_SURFACE;
    } else {
      this.rulesFlags &= ~R_HAS_EXACT_MIXIN_CHILD_SURFACE;
    }
  }

  get hasExactRulesetChildSurface(): boolean {
    return (this.rulesFlags & R_HAS_EXACT_RULESET_CHILD_SURFACE) !== 0;
  }

  set hasExactRulesetChildSurface(value: boolean) {
    if (value) {
      this.rulesFlags |= R_HAS_EXACT_RULESET_CHILD_SURFACE;
    } else {
      this.rulesFlags &= ~R_HAS_EXACT_RULESET_CHILD_SURFACE;
    }
  }

  get hasMergeOutputSurface(): boolean {
    return (this.rulesFlags & R_HAS_MERGE_OUTPUT_SURFACE) !== 0;
  }

  set hasMergeOutputSurface(value: boolean) {
    if (value) {
      this.rulesFlags |= R_HAS_MERGE_OUTPUT_SURFACE;
    } else {
      this.rulesFlags &= ~R_HAS_MERGE_OUTPUT_SURFACE;
    }
  }

  get directDeclarationsByName(): Map<string, Declaration[] | null> | undefined {
    return this._lookup?.directDeclarationsByName;
  }

  set directDeclarationsByName(value: Map<string, Declaration[] | null> | undefined) {
    this.ensureLookup().directDeclarationsByName = value;
  }

  get directDeclarationLookupCache(): Map<string, {
    readonly optionalMatch: DirectDeclarationOccurrence | undefined;
    readonly publicMatch: DirectDeclarationOccurrence | undefined;
    readonly readonly: boolean;
  }> | undefined {
    return this._lookup?.directDeclarationLookupCache;
  }

  set directDeclarationLookupCache(value: Map<string, {
    readonly optionalMatch: DirectDeclarationOccurrence | undefined;
    readonly publicMatch: DirectDeclarationOccurrence | undefined;
    readonly readonly: boolean;
  }> | undefined) {
    this.ensureLookup().directDeclarationLookupCache = value;
  }

  get lookupVersion(): number {
    return this._lookup?.lookupVersion ?? 0;
  }

  set lookupVersion(value: number) {
    this.ensureLookup().lookupVersion = value;
  }

  get declarationLookupVersion(): number {
    return this._lookup?.declarationLookupVersion ?? 0;
  }

  set declarationLookupVersion(value: number) {
    this.ensureLookup().declarationLookupVersion = value;
  }

  get declarationLookupVersionsByName(): Map<string, number> | undefined {
    return this._lookup?.declarationLookupVersionsByName;
  }

  set declarationLookupVersionsByName(value: Map<string, number> | undefined) {
    this.ensureLookup().declarationLookupVersionsByName = value;
  }

  get callableLookupVersion(): number {
    return this._lookup?.callableLookupVersion ?? 0;
  }

  set callableLookupVersion(value: number) {
    this.ensureLookup().callableLookupVersion = value;
  }

  get functionLookupVersion(): number {
    return this._lookup?.functionLookupVersion ?? 0;
  }

  set functionLookupVersion(value: number) {
    this.ensureLookup().functionLookupVersion = value;
  }

  get functionLookupVersionsByName(): Map<string, number> | undefined {
    return this._lookup?.functionLookupVersionsByName;
  }

  set functionLookupVersionsByName(value: Map<string, number> | undefined) {
    this.ensureLookup().functionLookupVersionsByName = value;
  }

  /** ScopeFrame storage; check this when lookup must not lazily build a frame. */
  _scopeFrame: ScopeFrame | undefined;
  /**
   * Transient, set for exactly one eval when `_evalPreparedRules` re-points this
   * shared canonical body child's lexical frame parent to a per-call placement
   * scope (§4). It marks the node as a re-used body whose evaluated output must NOT
   * be baked back into the shared template (Ruleset.finishEvaluatedRules reads +
   * clears it), so a second call of the enclosing mixin re-evaluates cleanly.
   */
  get _placementRepointed(): boolean {
    return (this.rulesFlags & R_PLACEMENT_REPOINTED) !== 0;
  }

  set _placementRepointed(value: boolean) {
    if (value) {
      this.rulesFlags |= R_PLACEMENT_REPOINTED;
    } else {
      this.rulesFlags &= ~R_PLACEMENT_REPOINTED;
    }
  }

  /**
   * Set once this Rules' body has been evaluated (even a lazy mixin body, when it
   * IS evaluated). Narrow §2.7 eval-state signal — the replacement for the deleted
   * general `evaluated` flag, mirroring `Call._evaluatedCallOutput`. Purely gates
   * lazy child-frame construction in callable-descendant lookup: an uncalled body
   * must stay cold (broad crawl), an evaluated body may expose its frame.
   */
  get _bodyEvaluated(): boolean {
    return (this.rulesFlags & R_BODY_EVALUATED) !== 0;
  }

  set _bodyEvaluated(value: boolean) {
    if (value) {
      this.rulesFlags |= R_BODY_EVALUATED;
    } else {
      this.rulesFlags &= ~R_BODY_EVALUATED;
    }
  }

  /**
   * Closure environment for a detached ruleset: the per-call eval surface where
   * this detached ruleset was WRITTEN (captured at arg-binding). A detached
   * ruleset is a lexical closure — when later invoked (`@content()`), its free
   * variables resolve up THIS surface (which carries per-call param live-slots),
   * not its canonical `sourceNode.parent` (which lacks them). See
   * parseman-wrapper-is-scope-identity.
   */
  get _closureScope(): Rules | undefined {
    return this._lookup?._closureScope;
  }

  set _closureScope(value: Rules | undefined) {
    this.ensureLookup()._closureScope = value;
  }

  /**
   * Track whether this Rules subtree contains extend instructions.
   * Prep work for Track 5 segmented render selection.
   */
  get _hasExtends(): boolean {
    return (this.rulesFlags & R_HAS_EXTENDS) !== 0;
  }

  set _hasExtends(value: boolean) {
    if (value) {
      this.rulesFlags |= R_HAS_EXTENDS;
    } else {
      this.rulesFlags &= ~R_HAS_EXTENDS;
    }
  }

  /**
   * Track whether this Rules subtree contains any reference-import render
   * surfaces (`referenceMode` wrappers or reference/dedupe style imports).
   * Used to skip serializer-time reference-origin work when impossible.
   */
  get _hasReferenceImports(): boolean {
    return (this.rulesFlags & R_HAS_REFERENCE_IMPORTS) !== 0;
  }

  set _hasReferenceImports(value: boolean) {
    if (value) {
      this.rulesFlags |= R_HAS_REFERENCE_IMPORTS;
    } else {
      this.rulesFlags &= ~R_HAS_REFERENCE_IMPORTS;
    }
  }

  private get _registrationPrepared(): boolean {
    return (this.rulesFlags & R_REGISTRATION_PREPARED) !== 0;
  }

  private set _registrationPrepared(value: boolean) {
    if (value) {
      this.rulesFlags |= R_REGISTRATION_PREPARED;
    } else {
      this.rulesFlags &= ~R_REGISTRATION_PREPARED;
    }
  }

  /**
   * Rules clones still need to preserve function bindings so visitor/plugin
   * registrations survive the explicit clone sites that remain outside the hot path.
   */
  override toJSON(): Record<string, unknown> {
    // `_scopeFrame` back-references this `Rules` (frame → rulesNode) at eval
    // time, so it must be dropped to keep `JSON.stringify` cycle-safe — the same
    // discipline as the base back-refs (sourceNode/parent/_sourceRoot). The
    // lookup caches hold resolved callables/frames that can also retain
    // back-refs; they are derived, non-tree data, so drop them too.
    const json = super.toJSON();
    // `_treeContext` (context → sourceTrees → nodes) is a Rules-only back-ref;
    // drop it here to keep `JSON.stringify` cycle-safe.
    delete json._treeContext;
    delete json._scopeFrame;
    // The cold lookup fields now live on `_lookup` (a nested struct). Drop the raw
    // struct and re-emit only the non-cyclic, non-cache subset at top level so the
    // serialized shape matches the pre-slim behavior (functions + child-entry
    // surfaces + version counters kept; `callableLookupCache` /
    // `directDeclarationLookupCache` / `_closureScope` back-ref dropped).
    delete json._lookup;
    const lookup = this._lookup;
    if (lookup) {
      json.varsByName = lookup.varsByName;
      json.functionsByName = lookup.functionsByName;
      json.functionLookupVersion = lookup.functionLookupVersion;
      json.functionLookupVersionsByName = lookup.functionLookupVersionsByName;
      json.directChildRuleEntries = lookup.directChildRuleEntries;
      json.directDeclarationChildEntries = lookup.directDeclarationChildEntries;
      json.directDeclarationsByName = lookup.directDeclarationsByName;
      json.declarationLookupVersion = lookup.declarationLookupVersion;
      json.declarationLookupVersionsByName = lookup.declarationLookupVersionsByName;
      json.callableLookupVersion = lookup.callableLookupVersion;
      json.lookupVersion = lookup.lookupVersion;
    }
    return json;
  }

  override clone(cloneFn?: (n: Node) => Node): this {
    const source = this.rules;
    let value: Node[];
    if (cloneFn) {
      value = new Array<Node>(source.length);
      for (let i = 0; i < source.length; i++) {
        value[i] = cloneFn(source[i]!);
      }
    } else {
      value = [...source];
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return this.derive(value) as this;
  }

  /**
   * Construct an EMPTY same-type surface (so the constructor parents nothing).
   * Subclasses with extra child fields (Ruleset's selector/guard) override this
   * to carry those fields WITHOUT adopting/reparenting the shared canonical
   * nodes — the surface only links back via `sourceNode`.
   */
  protected _deriveShell(sourceLocation: LocationInfo | undefined): Rules {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const Ctor = this.constructor as new (
      value: Node[],
      options?: RulesOptions,
      location?: LocationInfo,
      treeContext?: TreeContext
    ) => Rules;
    return new Ctor(
      [],
      this.options ? { ...this.options } : undefined,
      sourceLocation,
      this.sourceRoot?._treeContext
    );
  }

  derive(value: Node[] = [...this.rules]): Rules {
    const sourceLocation = sourceSpanOf(this);
    // Thin surface: construct EMPTY (so the constructor parents nothing) and
    // SHARE the children — push without adopting, so a shared canonical child's
    // parent is never overwritten. `sourceNode` is the surface's only link back
    // to canonical (used for declaration lookup). See LIVE_BINDING_ARCHITECTURE.md.
    const derived = this._deriveShell(sourceLocation);
    derived.sourceNode = this.sourceNode ?? this;
    derived.inherit(this);
    derived.resetDerivedState(this);
    for (let i = 0; i < value.length; i++) {
      const child = value[i]!;
      derived.rules.push(child);
      if (hasCarriedMergeOutputSurface(child)) {
        derived.hasMergeOutputSurface = true;
      }
    }

    return derived;
  }

  private resetDerivedState(source: Rules): void {
    // IMPORTANT: cloned Rules must rebuild their derived lookup state. Otherwise a
    // clone can inherit empty/incorrect lookup maps, causing lookup misses (e.g. @c
    // in detached-rulesets). The derive shell starts with `_lookup === undefined`
    // (all cold lookup fields at their neutral value), so the only thing to carry
    // across is the explicit function-binding subset below — everything else is
    // already cleared by virtue of the struct being unallocated.
    //
    // Only preserve explicit function bindings across clones. This supports Less
    // plugin compat without reusing derived declaration/callable lookup state,
    // which must be rebuilt from AST nodes via lazy indexing.
    if (source.functionsByName) {
      const lookup = this.ensureLookup();
      lookup.functionsByName = new Map(source.functionsByName);
      lookup.functionLookupVersion = source.functionLookupVersion;
      lookup.functionLookupVersionsByName = source.functionLookupVersionsByName
        ? new Map(source.functionLookupVersionsByName)
        : undefined;
    }
    // Clear all child-derived surface bits + _hasExtends/_hasReferenceImports in
    // one masked write. Deliberately leaves _bodyEvaluated and _registrationPrepared
    // untouched, matching the prior per-field resets (which did not reset those).
    this.rulesFlags &= ~R_DERIVED_STATE_MASK;
    if (this._lookup) {
      this._lookup.varsByName = undefined;
      this._lookup.lookupVersion = 0;
    }
    // Preserve only runtime live-slot bindings (mixin params / loop vars) across clones.
    // Ordinary declaration-only ScopeFrames should be rebuilt lazily on the clone so they
    // re-wire against the clone's actual parent chain. Reusing an empty frame from the
    // source tree can shadow a live wrapper frame that actually carries live slots.
    if (source._scopeFrame?.hasLiveBindings || source._scopeFrame?.fallbackFrame) {
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
  /**
   * True once this Rules' body has been evaluated. Public read of the narrow
   * §2.7 eval-state signal (`_bodyEvaluated`); lets render/serialize callers
   * confirm they hold the evaluated root, not a pre-eval source tree.
   */
  get evaluated(): boolean {
    return this._bodyEvaluated;
  }

  get scopeFrame(): ScopeFrame {
    return this.getScopeFrame();
  }

  set scopeFrame(frame: ScopeFrame | undefined) {
    this._scopeFrame = frame;
  }

  getScopeFrame(parent?: ScopeFrame, prepareCallableCoverage = true): ScopeFrame {
    const startedAt = scopeFrameProfileNow?.();
    if (!this._scopeFrame) {
      const rulesBody = this.rules;
      let pendingDeclarationNames: VarDeclaration[] | undefined;
      if (this.varsByName === undefined) {
        pendingDeclarationNames = this.prepareScopeFrameDeclarationIndex(rulesBody);
      }
      let resolvedParent = parent;
      if (resolvedParent === undefined) {
        let cursor = this.parent;
        while (cursor) {
          if (isNode(cursor, N.Rules)) {
            resolvedParent = (cursor as Rules).getScopeFrame(undefined, prepareCallableCoverage);
            break;
          }
          cursor = cursor.parent;
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
      this.prepareScopeFrameAssignmentBindings(this._scopeFrame, rulesBody);
      this.linkInlineImportFallbackFrames(this._scopeFrame, rulesBody);
      recordScopeFrameProfile?.('create', this, this._scopeFrame, startedAt);
    } else {
      recordScopeFrameProfile?.('cacheHit', this, this._scopeFrame, startedAt);
    }
    return this._scopeFrame;
  }

  // A non-boundary `@import` inlines its body into this scope. Chain each such
  // imported Rules' own scope frame (which already indexes the imported decls +
  // callables) as this frame's fallback, so lookups resolve imported symbols on the
  // fast frame path — consulted only AFTER the primary scope chain, so an enclosing
  // declaration always wins. Boundaries (`@compose` = true, rulesets = undefined)
  // are skipped. Reuses the already-read rules array (no extra scan).
  private linkInlineImportFallbackFrames(frame: ScopeFrame, rulesBody: Node[]): void {
    for (let i = 0; i < rulesBody.length; i++) {
      const child = rulesBody[i]!;
      if (!(child instanceof Rules) || !importInlinesMembersToParent(child)) {
        continue;
      }
      linkImportFallbackFrame(frame, child.getScopeFrame());
    }
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

  private prepareScopeFrameDeclarationIndex(value = this.rules): VarDeclaration[] | undefined {
    const varsByName = this.varsByName = new Map();
    let pendingDeclarationNames: VarDeclaration[] | undefined;
    this._hasReferenceImports = (
      this._hasReferenceImports
      || this.hasReferenceImportChildSurface
      || this.options.referenceMode === true
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
      if (isBindingReassignment(node)) {
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
      bucket.push(createVarDeclarationBindingEntry(node));
    }
    return pendingDeclarationNames;
  }

  private prepareScopeFrameAssignmentBindings(frame: ScopeFrame, value = this.rules): void {
    const childEntries = this.collectDirectDeclarationChildEntries(value);
    this.collectPublicChildVariableAssignmentBindingsInto(false, frame, frame, childEntries ?? null);
    frame.hasUncoveredAssignmentTargetSurface = this.hasUncoveredChildVariableAssignmentSurface(childEntries ?? null);
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
    shadowingFrame?: ScopeFrame,
    childEntries: Array<RulesEntryLike> | null | undefined = this.collectDirectDeclarationChildEntries()
  ): void {
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
          && !isBindingReassignment(node)
          && !this._hasStaticName(node)
        ) {
          return true;
        }
      }
    }
    return this.hasUncoveredChildVariableAssignmentSurface();
  }

  private hasUncoveredChildVariableAssignmentSurface(
    childEntries: Array<RulesEntryLike> | null | undefined = this.collectDirectDeclarationChildEntries()
  ): boolean {
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
        && this.options.referenceMode !== true
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
      const child = childCallableRulesOf(value[i]!);
      const childHasSurface = includeRulesets
        ? child && rulesMayContainExactCallableSurface(child)
        : child && rulesMayContainExactMixinSurface(child);
      if (childHasSurface) {
        return true;
      }
    }
    return false;
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
    const rulesetsOnly = options?.rulesetsOnly === true;
    const collectBucketResults = (candidates: CallableLookupEntry[]): boolean => {
      let found = false;
      for (let i = candidates.length - 1; i >= 0; i--) {
        const entry = candidates[i]!;
        if (entry.match.length !== 0) {
          continue;
        }
        const candidate = entry.value;
        if (!includeRulesets && isNode(candidate, N.Ruleset)) {
          continue;
        }
        // Ruleset-only ($apply / *[…]): keep plain Rulesets, drop Mixins etc.
        if (rulesetsOnly && !isNode(candidate, N.Ruleset)) {
          continue;
        }
        (results ??= []).push(candidate);
        found = true;
      }
      return found;
    };
    const collectWithinScopeSurface = (
      scope: Rules,
      localContext: boolean | undefined,
      visited?: Set<Rules>,
      includeCurrentSurface = true
    ): Set<Rules> | undefined => {
      if (visited?.has(scope)) {
        return visited;
      }
      if (visited) {
        visited.add(scope);
      }

      if (includeCurrentSurface) {
        const candidates = scope.getCallableEntriesForKey(key);
        if (candidates.length > 0) {
          collectBucketResults(candidates);
        }
      }

      if (scope.directChildRuleEntries === null) {
        return visited;
      }
      const childEntries = scope.directChildRuleEntries !== undefined
        ? (scope.directChildRuleEntries ?? undefined)
        : scope.collectDirectChildRulesEntries();
      if (!childEntries?.length) {
        return visited;
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
        visited = collectWithinScopeSurface(
          entry.node,
          localContext || Boolean(entry.node.options?.local),
          visited,
          true
        );
      }

      return visited;
    };

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
        collectWithinScopeSurface(
          scope,
          options?.local,
          undefined,
          options?.skipCurrentSurface !== true
        );
      }
      cursor = cursor.parent;
      if (options?.searchParents === false) {
        break;
      }
    }
    return results ?? [];
  }

  private findMixinsFastForUncoveredCallable(
    key: string,
    reason: Extract<ScopeFrameCallableLookupResult, { kind: 'uncovered' }>['reason'],
    includeRulesets: boolean,
    options: CallableFindOptions,
    rulesetsOnly = false
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
      if (reason === 'child-surface' || entry.hasReferenceImportSurface === true) {
        modeledChildSurface = true;
      }
      if (!canEnterRulesEntryForLookup(entry, { type: 'Mixin', hasTarget: options.hasTarget })) {
        continue;
      }
      if (entry.node.options?.forward) {
        continue;
      }
      if (options.local && entry.node.options?.local) {
        continue;
      }
      const childFrame = entry.node.getScopeFrame();
      entry.node.prepareCallableLookupFrame(childFrame, key, includeRulesets);
      const frameHit = lookupScopeFrameCallable(childFrame, key, {
        includeRulesets,
        searchParents: false
      });
      if (frameHit.kind === 'hit') {
        const results = collectCallableBucketResults(frameHit.bucket, includeRulesets, rulesetsOnly);
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
        const direct = uncoveredChildren[i]!.findMixinsFastForUncoveredCallable(
          key,
          reason,
          includeRulesets,
          options,
          rulesetsOnly
        );
        if (direct !== UNCOVERED_CALLABLE_UNSUPPORTED) {
          if (direct.length > 0) {
            (frameResults ??= []).push(...direct);
          }
        }
      }
    } else {
      const direct = firstUncoveredChild.findMixinsFastForUncoveredCallable(
        key,
        reason,
        includeRulesets,
        options,
        rulesetsOnly
      );
      if (direct !== UNCOVERED_CALLABLE_UNSUPPORTED && direct.length > 0) {
        frameResults = direct;
      }
    }
    if (frameResults) {
      return frameResults;
    }
    return modeledChildSurface ? UNCOVERED_CALLABLE_MISS : UNCOVERED_CALLABLE_UNSUPPORTED;
  }

  private addCallableEntry(
    key: string | undefined,
    value: MixinEntry,
    match: string[],
    index: Map<string, CallableLookupEntry[]>
  ): void {
    if (!key || key.startsWith(':')) {
      return;
    }
    let bucket = index.get(key);
    if (bucket === undefined) {
      index.set(key, bucket = []);
    }
    bucket.push({ value, match });
  }

  private addCallableSelectors(
    ruleset: Ruleset,
    keys: string[],
    index: Map<string, CallableLookupEntry[]>,
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
    this.addCallableEntry(key, ruleset, match ?? [], index);
  }

  private collectCallablesFor(
    rules: Rules,
    index: Map<string, CallableLookupEntry[]>
  ): void {
    const value = rules.rules;
    for (let i = 0; i < value.length; i++) {
      const node = value[i]!;
      if (isNode(node, N.Mixin)) {
        const name = node.name;
        if (typeof name === 'string') {
          this.addCallableEntry(name, node, [], index);
        }
        continue;
      }
      if (!isNode(node, N.Ruleset)) {
        continue;
      }
      let selector = node.selector;
      if (typeof selector === 'string') {
        // Parsed simple selectors (`#theme`, `.button`) are stored as plain
        // strings, not Selector nodes, but they are valid callable namespaces —
        // register them under their split ordered keys just like node selectors.
        this.addCallableSelectors(node, splitSelectorStringKeys(selector), index);
        continue;
      }
      if (!selector || isNode(selector, N.Nil)) {
        continue;
      }
      const ownSelector = isSelectorLikeNode(node.options.ownSelector)
        ? node.options.ownSelector
        : undefined;
      const callableSelector = ownSelector && !isNode(ownSelector, N.Nil) ? ownSelector : selector;
      if (isNode(callableSelector, N.Ampersand)) {
        continue;
      }
      const sourceSelector = isSelectorLikeNode(selector.sourceNode)
        ? selector.sourceNode
        : undefined;
      // A bare array selector IS a comma-separated selector list (the lean
      // strings-not-nodes surface for `.bo, .bar { ... }`). Each member is an
      // independent selector, so register every member as its own callable —
      // otherwise a flat `getOrderedSelectorKeys` would fold the whole group
      // into one ordered namespace path (`.bo` → `.bar`), leaving later members
      // (`.bar()`) unresolvable while the first (`.bo()`) still matched.
      if (Array.isArray(selector)) {
        for (const item of selector) {
          this.addCallableSelectors(node, getOrderedSelectorKeys(item), index);
        }
        continue;
      }
      let keys = getOrderedSelectorKeys(selector);
      if (keys.length === 0 && sourceSelector) {
        const sourceKeys = getOrderedSelectorKeys(sourceSelector);
        if (sourceKeys.length > 0) {
          selector = sourceSelector;
          keys = sourceKeys;
        }
      }
      if (isNode(selector, N.SelectorList)) {
        for (const item of selector.value) {
          if (typeof item !== 'string') {
            this.addCallableSelectors(
              node,
              getOrderedSelectorKeys(item),
              index
            );
          }
        }
        continue;
      }
      if (keys.length > 0 && ownSelector && !isNode(ownSelector, N.Nil)) {
        const parentSelector = isNode(node.parent?.parent, N.Ruleset)
          ? (node.parent.parent as Ruleset).selector
          : undefined;
        const parentKeys = parentSelector && !isNode(parentSelector, N.Nil) && typeof parentSelector !== 'string'
          ? getOrderedSelectorKeys(parentSelector)
          : [];
        if (
          parentKeys.length > 0
          && keys.length > parentKeys.length
          && keysStartWith(keys, parentKeys)
        ) {
          this.addCallableSelectors(node, keys, index, parentKeys.length);
          continue;
        }
      }
      this.addCallableSelectors(node, keys, index);
    }
  }

  /**
   * Build (once) and memoize the full callable index for THIS scope: a single pass
   * over `rules` that buckets every callable by its own key. Reused across all
   * distinct-key lookups against this scope instead of re-scanning per key.
   * Invalidated with `callableLookupCache` when the scope's callable set changes.
   */
  private ensureCallableIndex(): Map<string, CallableLookupEntry[]> {
    let index = this._lookup?.callableFullIndex;
    if (index !== undefined) {
      return index;
    }
    index = new Map();
    this.collectCallablesFor(this, index);
    this.ensureLookup().callableFullIndex = index;
    return index;
  }

  private getCallableEntriesForKey(
    lookupKey: string,
    updateFrameMissCoverage = true
  ): CallableLookupEntry[] {
    const entries = this.callableLookupCache;
    if (entries?.has(lookupKey)) {
      return entries.get(lookupKey) ?? EMPTY_CALLABLE_BUCKET;
    }

    let bucket = this.ensureCallableIndex().get(lookupKey);
    if (bucket === undefined) {
      const sourceRules = sourceRulesOf(this);
      if (sourceRules !== this) {
        bucket = sourceRules.ensureCallableIndex().get(lookupKey);
      }
    }
    (this.callableLookupCache ??= new Map()).set(
      lookupKey,
      bucket === undefined || bucket.length === 0 ? null : bucket
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
    return bucket ?? EMPTY_CALLABLE_BUCKET;
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
      const child = childCallableRulesOf(value[i]!);
      if (!child) {
        continue;
      }
      const hasReferenceImportSurface = rulesMayContainReferenceImports(child);
      this.hasReferenceImportChildSurface ||= hasReferenceImportSurface;
      const hasExactCallableSurface = rulesMayContainExactCallableSurface(child);
      if (!hasReferenceImportSurface && !hasExactCallableSurface) {
        continue;
      }
      const hasExactMixinSurface = hasExactCallableSurface && rulesMayContainExactMixinSurface(child);
      const hasExactRulesetSurface = hasExactCallableSurface && rulesMayContainExactRulesetSurface(child);
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

  collectDirectDeclarationChildEntries(value = this.rules): Array<RulesEntryLike> | undefined {
    if (this.directDeclarationChildEntries !== undefined) {
      return this.directDeclarationChildEntries ?? undefined;
    }
    let out: Array<RulesEntryLike> | undefined;
    for (let i = 0; i < value.length; i++) {
      const child = childRulesOf(value[i]!);
      if (!child) {
        continue;
      }
      const hasDeclarationSurface = rulesMayContainDeclarationSurface(child);
      const hasVarDeclarationSurface = rulesMayContainVarDeclarationSurface(child);
      const hasReferenceImportSurface = rulesMayContainReferenceImports(child);
      this.hasDeclarationChildSurface ||= hasDeclarationSurface;
      this.hasVarDeclarationChildSurface ||= hasVarDeclarationSurface;
      this.hasReferenceImportChildSurface ||= hasReferenceImportSurface;
      const entry: RulesEntryLike = {
        node: child,
        rulesVisibility: this.getDirectChildRulesVisibility(child),
        readonly: Boolean(child.options.readonly),
        hasDeclarationSurface,
        hasVarDeclarationSurface,
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
    const hasReferenceImportSurface = rulesMayContainReferenceImports(child);
    this.hasDeclarationChildSurface ||= hasDeclarationSurface;
    this.hasVarDeclarationChildSurface ||= hasVarDeclarationSurface;
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
          !isBindingReassignment(changedVariable)
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
            value: changedVariable.value,
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
    if (isNode(this.parent, N.Rules)) {
      this.parent.refreshDirectDeclarationChildEntryAssignmentSummary(this, changedVariable);
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

  private findCallableRulesetPath(
    path: string[],
    options?: CallableFindOptions,
    pathStart = 0
  ): Ruleset[] {
    const searchSurface = (
      scope: Rules,
      localContext: boolean | undefined,
      results: Ruleset[],
      visited?: Set<Rules>
    ): void => {
      if (visited?.has(scope)) {
        return;
      }
      if (visited) {
        visited.add(scope);
      }

      const segment = path[pathStart];
      if (segment) {
        const directMatches = collectCallableBucketRemainderResults(
          scope.getCallableEntriesForKey(segment),
          true,
          path,
          pathStart
        );
        if (directMatches) {
          for (let i = 0; i < directMatches.length; i++) {
            const match = directMatches[i];
            if (isNode(match, N.Ruleset)) {
              results.push(match);
            }
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
        searchSurface(
          entry.node,
          localContext || Boolean(entry.node.options?.local),
          results,
          visited
        );
      }
    };

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
        searchSurface(scope, options?.local, results);
      }
      if (options?.searchParents === false) {
        break;
      }
      cursor = cursor.parent;
    }
    return results;
  }

  private findCallablePrefixMatches(
    path: string[],
    options?: CallableFindOptions,
    pathStart = 0
  ): CallableRulesetPrefixMatch[] {
    const searchSurface = (
      scope: Rules,
      localContext: boolean | undefined,
      results: CallableRulesetPrefixMatch[],
      visited?: Set<Rules>
    ): void => {
      if (visited?.has(scope)) {
        return;
      }
      if (visited) {
        visited.add(scope);
      }

      const segment = path[pathStart];
      if (segment) {
        const directPrefixMatches = collectCallableBucketRulesetPrefixMatches(
          scope.getCallableEntriesForKey(segment),
          path,
          pathStart,
          scope
        );
        if (directPrefixMatches) {
          for (let i = 0; i < directPrefixMatches.length; i++) {
            results.push(directPrefixMatches[i]!);
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
        searchSurface(
          entry.node,
          localContext || Boolean(entry.node.options?.local),
          results,
          visited
        );
      }
    };

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
        searchSurface(scope, options?.local, results);
      }
      if (options?.searchParents === false) {
        break;
      }
      cursor = cursor.parent;
    }
    return results;
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
      if (scope._scopeFrame) {
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
        if (isNode(match, N.Ruleset)) {
          if (!includeRulesets) {
            return undefined;
          }
          nestedScope = match;
        } else if (isNode(match, N.Mixin)) {
          if (!mixinHasNoRequiredParams(match)) {
            sawDefiniteMiss = true;
            continue;
          }
          nestedScope = match;
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
        if (nestedResults === undefined) {
          nestedResults = resolved.entries;
          nestedResultsOwned = resolved.owned;
          continue;
        }
        if (!nestedResultsOwned) {
          nestedResults = [...nestedResults];
          nestedResultsOwned = true;
        }
        for (let resolvedIndex = 0; resolvedIndex < resolved.entries.length; resolvedIndex++) {
          nestedResults.push(resolved.entries[resolvedIndex]!);
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
    return result === DEFINITE_MIXIN_NAMESPACE_MISS ? [] : result?.entries;
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

  private prepareCallableFrameChain(
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

  private hasMixinNamespace(
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

  private collectRulesetPrefixes(
    frame: ScopeFrame,
    path: string[],
    results: CallableRulesetPrefixMatch[],
    pathStart = 0
  ): void {
    const segment = path[pathStart];
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
        if (entry.match[matchIndex] !== path[pathStart + matchIndex + 1]) {
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

  private collectCallableRulesetExactMatchesFromFrame(
    frame: ScopeFrame,
    path: string[],
    results: Ruleset[],
    pathStart = 0
  ): void {
    const segment = path[pathStart];
    if (!segment || !isNode(frame.rulesNode, N.Rules)) {
      return;
    }
    const bucket = frame.callableBucketsByName?.get(segment);
    if (!bucket?.length) {
      return;
    }
    const matches = collectCallableBucketRemainderResults(bucket, true, path, pathStart);
    if (!matches) {
      return;
    }
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      if (isNode(match, N.Ruleset)) {
        results.push(match);
      }
    }
  }

  private collectChildCallableRulesetPrefixMatchesFromFrames(
    scope: Rules,
    path: string[],
    options: CallableFindOptions,
    results: CallableRulesetPrefixMatch[],
    pathStart = 0
  ): boolean {
    const segment = path[pathStart];
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
      this.collectRulesetPrefixes(childFrame, path, results, pathStart);
      if (
        (!childFrame.callableMissCoverageKnown || !childFrame.callableMissesCovered)
        && !this.prefixOwnsChildren(scope, entry.node, segment, results)
      ) {
        covered = false;
      }
    }
    return covered;
  }

  private collectChildCallableRulesetExactMatchesFromFrames(
    scope: Rules,
    path: string[],
    options: CallableFindOptions,
    results: Ruleset[],
    pathStart = 0
  ): boolean {
    const segment = path[pathStart];
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
      this.collectCallableRulesetExactMatchesFromFrame(childFrame, path, results, pathStart);
      if (!childFrame.callableMissCoverageKnown || !childFrame.callableMissesCovered) {
        covered = false;
      }
    }
    return covered;
  }

  private collectVisiblePrefixes(
    frame: ScopeFrame,
    path: string[],
    searchParents: boolean,
    options: CallableFindOptions,
    results: CallableRulesetPrefixMatch[],
    pathStart = 0
  ): boolean {
    const segment = path[pathStart];
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
      this.collectRulesetPrefixes(cursor, path, results, pathStart);
      if (!this.collectChildCallableRulesetPrefixMatchesFromFrames(scope, path, options, results, pathStart)) {
        covered = false;
      }
      if (!searchParents) {
        break;
      }
      cursor = cursor.parent;
    }
    return covered;
  }

  private collectVisibleCallableRulesetExactMatchesFromFrames(
    frame: ScopeFrame,
    path: string[],
    searchParents: boolean,
    options: CallableFindOptions,
    results: Ruleset[],
    pathStart = 0
  ): boolean {
    const segment = path[pathStart];
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
      this.collectCallableRulesetExactMatchesFromFrame(cursor, path, results, pathStart);
      if (!this.collectChildCallableRulesetExactMatchesFromFrames(scope, path, options, results, pathStart)) {
        covered = false;
      }
      if (!searchParents) {
        break;
      }
      cursor = cursor.parent;
    }
    return covered;
  }

  private prefixOwnsChildren(
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
      // The prefix match IS this entry's own namespace ruleset. That holds for
      // compound-selector namespaces (`#panel.dark.navbar`) too, where
      // `consumed` carries every selector key — not just a single segment.
      if (
        consumed.length >= 1
        && consumed[0] === segment
        && sourceRulesOf(ruleset) === entrySource
        && (matchScope === scope || matchSource === sourceRulesOf(scope))
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * True when `node` is a callable namespace with a definite own key that is
   * not `segment` and cannot emit into the enclosing ambient namespace. Such a
   * namespace's mixin surface lives behind its own name, so it never
   * contributes a `segment` callable to the scope that contains it.
   */
  private staticNamespaceExcludesKey(node: Rules, segment: string): boolean {
    // An ambient mixin-output surface can inject arbitrary callables into the
    // scope, so its key is not statically known — never skip it.
    if (node.options.mixinOutputSlot) {
      return false;
    }
    if (isNode(node, N.Mixin)) {
      const { name } = node;
      return typeof name === 'string' && name !== segment;
    }
    if (isNode(node, N.Ruleset)) {
      const { selector } = node;
      if (!selector || isNode(selector, N.Nil)) {
        return false;
      }
      // Simple selectors (`#theme`, `.button`) are stored as plain strings;
      // node selectors carry ordered keys. Either way, a resolvable first key
      // that differs from `segment` means the namespace is reachable only under
      // its own name — irrelevant to a `segment` lookup.
      const keys = typeof selector === 'string'
        ? splitSelectorStringKeys(selector)
        : getOrderedSelectorKeys(selector);
      return keys.length > 0 && keys[0] !== segment;
    }
    return false;
  }

  private uncertaintyLimitedToPrefixes(
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
      if (this.staticNamespaceExcludesKey(entry.node, segment)) {
        // A definitely-named callable namespace (`#ns() {…}`, `#panel.x {…}`)
        // gates its inner mixins behind its own key. It can never inject a
        // differently-named callable into this scope's ambient namespace, so a
        // `segment` lookup is unaffected by it — even though it carries a mixin
        // surface. Skip it so a sibling namespace doesn't defeat the fast path.
        continue;
      }
      if (!this.prefixOwnsChildren(scope, entry.node, segment, prefixMatches)) {
        return false;
      }
    }
    return true;
  }

  private visibleUncertaintyLimitedToPrefixes(
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
        if (!this.uncertaintyLimitedToPrefixes(
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
      cursor = cursor.parent;
    }
    return true;
  }

  private findRulesetNamespacePathFast(
    keys: string[],
    options: CallableFindOptions = {},
    pathStart = 0,
    // When the head namespace also exists in mixin form the walk defers to the
    // mixin path (returns undefined). Passing a collector captures the ruleset-form
    // prefix defs in the SAME pass so findMixinPath can UNION ruleset + mixin
    // namespace results (`#g when(…) {…} #g() {…}` — both contribute) without a
    // second full frame walk.
    despiteMixinNamespaceOut?: { entries?: MixinEntry[] }
  ): MixinEntry[] | undefined {
    if (keys.length - pathStart < 2) {
      return undefined;
    }

    const DEFINITE_MISS = Symbol('definite-ruleset-namespace-miss');
    type RulesetNamespaceFastResult = MixinEntry[] | typeof DEFINITE_MISS | undefined;
    const selectorNeedsLegacyFallback = (ruleset: Ruleset): boolean => {
      return blocksAmbientMixinOutputLookup(ruleset);
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
      let prefixMatches: CallableRulesetPrefixMatch[] = [];
      let hasMixinNamespace = false;
      let mixinNamespaceCovered = false;
      const scopeFrame = !options.hasTarget && !options.local
        ? scope.getScopeFrame()
        : undefined;
      if (scopeFrame) {
        this.collectVisiblePrefixes(
          scopeFrame,
          path,
          searchParents,
          options,
          prefixMatches,
          offset
        );
        this.prepareCallableFrameChain(scopeFrame, segment, false, searchParents);
        const frameHit = lookupScopeFrameCallable(scopeFrame, segment, {
          includeRulesets: false,
          searchParents
        });
        if (frameHit.kind === 'hit') {
          hasMixinNamespace = Boolean(collectCallableBucketResults(frameHit.bucket, false)?.length);
          mixinNamespaceCovered = true;
        } else if (frameHit.kind === 'miss') {
          mixinNamespaceCovered = true;
        } else if (
          frameHit.reason === 'child-surface'
          || frameHit.reason === 'reference-import'
          || frameHit.reason === 'frame'
        ) {
          if (frameHit.reason === 'reference-import' && prefixMatches.length === 0) {
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
          if (!mixinNamespaceCovered && this.hasMixinNamespace(scopeFrame, segment, searchParents)) {
            hasMixinNamespace = true;
            mixinNamespaceCovered = true;
          } else if (
            !mixinNamespaceCovered
            && prefixMatches.length > 0
            && this.visibleUncertaintyLimitedToPrefixes(
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
                hasMixinNamespace = Boolean(collectCallableBucketResults(fallbackHit.bucket, false)?.length);
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
              const fallbackPrefixMatches = fallbackFrame.rulesNode.findCallablePrefixMatches(path, {
                hasTarget: options.hasTarget,
                local: options.local,
                searchParents: false
              }, offset);
              if (fallbackPrefixMatches.length > 0) {
                prefixMatches = fallbackPrefixMatches;
                break;
              }
            }
            fallbackFrame = fallbackFrame.fallbackFrame;
          }
        }
      }
      if (prefixMatches.length === 0 && !scopeFrame) {
        prefixMatches = scope.findCallablePrefixMatches(path, {
          hasTarget: options.hasTarget,
          local: options.local,
          searchParents
        }, offset);
      }
      if (prefixMatches.length === 0 && !scopeFrame) {
        const directBucket = scope.getCallableEntriesForKey(segment);
        const directPrefixMatches = collectCallableBucketRulesetPrefixMatches(
          directBucket,
          path,
          offset,
          scope
        );
        if (directPrefixMatches?.length) {
          prefixMatches = directPrefixMatches;
        }
      }
      if (!mixinNamespaceCovered) {
        if (options.searchParents === false) {
          const uncoveredChildNamespaceMixins = scope.findMixinsFastForUncoveredCallable(
            segment,
            'child-surface',
            false,
            options
          );
          if (uncoveredChildNamespaceMixins !== UNCOVERED_CALLABLE_UNSUPPORTED) {
            hasMixinNamespace = uncoveredChildNamespaceMixins.length > 0;
            mixinNamespaceCovered = true;
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
      const captureDespiteMixinNamespace = hasMixinNamespace
        && despiteMixinNamespaceOut !== undefined
        && prefixMatches.length > 0;
      if (hasMixinNamespace && !captureDespiteMixinNamespace) {
        return undefined;
      }

      if (prefixMatches.length === 0) {
        if (options.terminalMixinOnly === true) {
          return DEFINITE_MISS;
        }
        let exactMatches: MixinEntry[] | undefined;
        if (scopeFrame) {
          scope.prepareCallableLookupFrame(scopeFrame, segment, true);
          const frameHit = lookupScopeFrameCallable(scopeFrame, segment, {
            includeRulesets: true,
            searchParents
          });
          if (frameHit.kind === 'hit') {
            exactMatches = collectCallableBucketRemainderResults(frameHit.bucket, true, path, offset);
          }
        }
        if (exactMatches === undefined && !scopeFrame) {
          exactMatches = collectCallableBucketRemainderResults(
            scope.getCallableEntriesForKey(segment),
            true,
            path,
            offset
          );
        }
        if (exactMatches?.length) {
          return exactMatches;
        }
        if (scopeFrame) {
          const exactFrameMatches: Ruleset[] = [];
          const exactFrameMatchesCovered = this.collectVisibleCallableRulesetExactMatchesFromFrames(
            scopeFrame,
            path,
            searchParents,
            options,
            exactFrameMatches,
            offset
          );
          if (exactFrameMatches.length > 0) {
            return exactFrameMatches;
          }
          if (exactFrameMatchesCovered) {
            return DEFINITE_MISS;
          }
        }
        if (!scopeFrame) {
          const exactPathMatches = scope.findCallableRulesetPath(path, {
            hasTarget: options.hasTarget,
            local: options.local,
            searchParents
          }, offset);
          if (exactPathMatches.length > 0) {
            return exactPathMatches;
          }
        }
        return DEFINITE_MISS;
      }

      // A mixin CALL (`#foo > .m()`) invokes every same-named namespace on the
      // path, so accumulate each prefix match's resolution. A bare value/index
      // lookup keeps override (last-wins) semantics — return the first match.
      const accumulate = options.mixinCall === true;
      // Longest-consumed prefixes win first. Stable-sort keeps the incoming
      // newest-first order within a length; the call accumulation wants source
      // order (oldest first) so later same-named namespaces override as authored,
      // so reverse within each equal-length group when accumulating.
      if (prefixMatches.length > 1) {
        if (accumulate) {
          prefixMatches.sort((a, b) => a.consumed.length - b.consumed.length).reverse();
        } else {
          prefixMatches.sort((a, b) => b.consumed.length - a.consumed.length);
        }
      }
      let sawLegacyOnlyPrefix = false;
      let simpleLookupOptions: ExactCallableFindOptions | undefined;
      let nestedOptions: CallableFindOptions | undefined;
      const existingNoParentOptions = options.searchParents === false ? options : undefined;
      const terminalFilterType = options.terminalMixinOnly === true ? 'Mixin' : undefined;
      let accumulated: MixinEntry[] | undefined;
      let accumulatedOwned = false;

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
          if (!accumulate) {
            return [ruleset];
          }
          if (accumulated === undefined) {
            accumulated = [ruleset];
            accumulatedOwned = true;
          } else {
            if (!accumulatedOwned) {
              accumulated = [...accumulated];
              accumulatedOwned = true;
            }
            accumulated.push(ruleset);
          }
          continue;
        }
        let resolved: MixinEntry[] | undefined;
        if (remainderLength === 1) {
          const segment = path[remainderStart]!;
          if (options.terminalMixinOnly === true) {
            nestedOptions ??= existingNoParentOptions ?? {
              ...options,
              searchParents: false
            };
            resolved = ruleset.findMixin(segment, 'Mixin', nestedOptions);
          } else {
            simpleLookupOptions ??= {
              hasTarget: options.hasTarget,
              local: options.local,
              includeRulesets: !options.terminalMixinOnly,
              searchParents: false
            };
            let simpleCallableCovered = false;
            const simpleFrame = !options.hasTarget && !options.local
              ? ruleset.getScopeFrame()
              : undefined;
            if (simpleFrame) {
              const includeRulesets = simpleLookupOptions.includeRulesets !== false;
              ruleset.prepareCallableLookupFrame(simpleFrame, segment, includeRulesets);
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
                const uncovered = ruleset.findMixinsFastForUncoveredCallable(
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
              const simpleCallableMatches = ruleset.findMixinsFast(segment, simpleLookupOptions);
              if (simpleCallableMatches.length > 0) {
                resolved = simpleCallableMatches;
              }
            }
            if (resolved === undefined && !options.terminalMixinOnly) {
              const simpleCallableRulesets = ruleset.findCallableRulesetPath(path, {
                hasTarget: options.hasTarget,
                local: options.local,
                searchParents: false
              }, remainderStart);
              resolved = simpleCallableRulesets.length > 0 ? simpleCallableRulesets : undefined;
            }
          }
        } else {
          nestedOptions ??= {
            ...options,
            searchParents: false
          };
          resolved = ruleset.resolveNamespaceRemainder(
            path,
            remainderStart,
            nestedOptions,
            terminalFilterType
          );
        }
        if (resolved?.length) {
          if (!accumulate) {
            return resolved;
          }
          if (accumulated === undefined) {
            accumulated = resolved;
          } else {
            if (!accumulatedOwned) {
              accumulated = [...accumulated];
              accumulatedOwned = true;
            }
            for (let i = 0; i < resolved.length; i++) {
              accumulated.push(resolved[i]!);
            }
          }
        }
      }

      if (captureDespiteMixinNamespace) {
        if (accumulated !== undefined && accumulated.length > 0) {
          despiteMixinNamespaceOut!.entries = accumulated;
        }
        return undefined;
      }
      if (accumulated !== undefined && accumulated.length > 0) {
        return accumulated;
      }
      return sawLegacyOnlyPrefix ? undefined : DEFINITE_MISS;
    };

    const result = walk(this, keys, pathStart, options.searchParents !== false);
    return result === DEFINITE_MISS ? [] : result;
  }

  private findCompoundPrefixPath(
    keys: string[],
    options: CallableFindOptions = {}
  ): CallableRulesetPathResult | undefined {
    if (keys.length < 2) {
      return undefined;
    }

    const prefixMatches = this.findCallablePrefixMatches(keys, {
      hasTarget: options.hasTarget,
      local: options.local
    });
    if (prefixMatches.length === 0) {
      return { entries: [], owned: true };
    }

    if (prefixMatches.length > 1) {
      prefixMatches.sort((a, b) => b.consumed.length - a.consumed.length);
    }
    let nestedOptions: CallableFindOptions | undefined;
    const existingNoParentOptions = options.searchParents === false ? options : undefined;
    const terminalFilterType = options.terminalMixinOnly === true ? 'Mixin' : undefined;

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
        resolved = ruleset.findMixin(keys[consumed.length]!, terminalFilterType, nestedOptions);
      } else {
        resolved = ruleset.resolveNamespaceRemainder(
          keys,
          consumed.length,
          nestedOptions,
          terminalFilterType
        );
      }
      if (resolved?.length) {
        return { entries: resolved, owned: false };
      }
    }

    return { entries: [], owned: true };
  }

  private findCallableDescendants(
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
    const terminalFilterType = options.terminalMixinOnly === true ? 'Mixin' : undefined;
    let resolved: MixinEntry[] | undefined;
    let resolvedOwned = false;
    let descendantMissCovered = false;
    // namespaceMixins arrives newest-first (reverse bucket order); walk it back
    // to front so same-named namespaces' descendant output accumulates in the
    // source order they were authored.
    for (let i = namespaceMixins.length - 1; i >= 0; i--) {
      const entry = namespaceMixins[i]!;
      if (!isNode(entry, N.Mixin)) {
        continue;
      }
      if (!mixinHasNoRequiredParams(entry)) {
        continue;
      }
      const firstRemainder = keys[1]!;
      const firstRemainderIncludesRulesets = keys.length === 2 && options.terminalMixinOnly !== true;
      const entryRules = entry;
      const childFrame = entryRules._scopeFrame ?? (entryRules._bodyEvaluated ? entryRules.getScopeFrame() : undefined);
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
              fallbackFrame = fallbackFrame.fallbackFrame!;
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
          // Crawl the frame's evaluated surface, not the canonical entry: a
          // namespace-mixin body evaluated for its reference imports splices the
          // import wrapper into the derived OUTPUT (frame.rulesNode), leaving the
          // canonical `[StyleImport]` untouched (invariant: canonical immutable).
          // The import-wrapper child surface lives only on the output.
          const uncoveredSurface = isNode(childFrame.rulesNode, N.Rules)
            ? childFrame.rulesNode
            : entryRules;
          const uncovered = uncoveredSurface.findMixinsFastForUncoveredCallable(
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
        nested = entryRules.findMixin(remainder, terminalFilterType, nestedOptions);
      } else if (nested === undefined) {
        nested = entryRules.resolveNamespaceRemainder(
          keys,
          1,
          nestedOptions,
          terminalFilterType
        );
      }
      if (nested?.length) {
        if (resolved === undefined) {
          resolved = nested;
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

    return resolved ?? (descendantMissCovered ? [] : undefined);
  }

  findMixin(
    keys: string | string[],
    filterType?: string,
    options: CallableFindOptions = {}
  ): MixinEntry[] | undefined {
    if (typeof keys === 'string') {
      const includeRulesets = filterType !== 'Mixin' && options.terminalMixinOnly !== true;
      // Bracket-capture call `*[.foo]()`: terminal hits must be plain Rulesets only.
      const rulesetsOnly = options.rulesetsOnly === true;
      const callableFrame = this._scopeFrame;
      if (callableFrame && !options.hasTarget && !options.local) {
        this.prepareCallableLookupFrame(callableFrame, keys, includeRulesets);
        const frameHit = lookupScopeFrameCallable(callableFrame, keys, {
          includeRulesets,
          searchParents: false
        });
        let frameMissCovered = false;
        if (frameHit.kind === 'hit') {
          const results = collectCallableBucketResults(frameHit.bucket, includeRulesets, rulesetsOnly);
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
            options,
            rulesetsOnly
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
            return this.findMixinPath(pathKeys, filterType, options);
          }
          return undefined;
        }
        if (frameHit.kind === 'miss' || frameHit.kind === 'uncovered') {
          let retryFrame = callableFrame.parent;
          // Reference/inline imports link their evaluated member surface as the
          // enclosing scope's own fallback frame (linkInlineImportFallbackFrames).
          // The retry walk visits each ancestor's primary frame but must also
          // consult the fallback chain hanging off any frame it passes — an
          // imported callable is otherwise invisible once the primary chain
          // exhausts. Queue fallback heads in encounter order (parent-chain first),
          // then drain them, so primaries always win.
          const fallbackQueue: ScopeFrame[] = [];
          let queuedFallback: ScopeFrame | undefined = callableFrame.fallbackFrame;
          while (queuedFallback) {
            fallbackQueue.push(queuedFallback);
            queuedFallback = queuedFallback.fallbackFrame;
          }
          let drainingFallbacks = false;
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
              const results = collectCallableBucketResults(retryHit.bucket, includeRulesets, rulesetsOnly);
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
                  options,
                  rulesetsOnly
                );
                if (direct !== UNCOVERED_CALLABLE_UNSUPPORTED) {
                  frameMissCovered = true;
                  if (direct.length > 0) {
                    return direct;
                  }
                }
              }
            }
            if (!drainingFallbacks && retryFrame.fallbackFrame) {
              let head: ScopeFrame | undefined = retryFrame.fallbackFrame;
              while (head) {
                fallbackQueue.push(head);
                head = head.fallbackFrame;
              }
            }
            retryFrame = retryFrame.parent;
            if (!retryFrame && fallbackQueue.length > 0) {
              retryFrame = fallbackQueue.shift();
              drainingFallbacks = true;
            }
          }
          if (frameHit.kind === 'miss') {
            const pathKeys = splitStaticCallablePathKey(keys);
            if (pathKeys) {
              return this.findMixinPath(pathKeys, filterType, options);
            }
            return undefined;
          }
          if (frameMissCovered) {
            const pathKeys = splitStaticCallablePathKey(keys);
            if (pathKeys) {
              return this.findMixinPath(pathKeys, filterType, options);
            }
            return undefined;
          }
          const pathKeys = splitStaticCallablePathKey(keys);
          if (pathKeys) {
            return this.findMixinPath(pathKeys, filterType, options);
          }
        }
      }
      const pathKeys = splitStaticCallablePathKey(keys);
      if (pathKeys) {
        return this.findMixinPath(pathKeys, filterType, options);
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
      return this.findMixinPath(keys, filterType, options);
    }
    return undefined;
  }

  /**
   * Resolve the tail of a namespace path (everything after a consumed prefix or
   * a matched head namespace) uniformly: a namespace is a namespace, so ruleset-
   * form and mixin-form segments resolve through the same ordered fallthrough
   * (ruleset-form path, then mixin-form path, then the generic key lookup). This
   * is the single remainder resolver the three namespace walks all delegate to.
   */
  private resolveNamespaceRemainder(
    path: string[],
    offset: number,
    nestedOptions: CallableFindOptions,
    terminalFilterType: 'Mixin' | undefined
  ): MixinEntry[] | undefined {
    let resolved = this.findRulesetNamespacePathFast(path, nestedOptions, offset);
    if (resolved === undefined) {
      resolved = this.findMixinNamespacePathFast(path, undefined, nestedOptions, offset);
    }
    if (resolved === undefined) {
      resolved = this.findMixin(
        collectKeyRemainder(path, offset),
        terminalFilterType,
        nestedOptions
      );
    }
    return resolved;
  }

  /**
   * Resolve a multi-segment namespace path (`#theme > .dark > .colors`) via the
   * frame fast path. Leads with `findRulesetNamespacePathFast`, which walks the
   * scope-frame chain to the frame that owns the head namespace — so a single
   * pass at the current scope resolves the whole path without a per-scope
   * array crawl. The string branch splits static paths straight to here rather
   * than round-tripping through the public array-form `findMixin`.
   */
  private findMixinPath(
    keys: string[],
    filterType?: string,
    options: CallableFindOptions = {}
  ): MixinEntry[] | undefined {
    const mixinFilterType = filterType === 'Mixin' ? 'Mixin' : undefined;
    let compoundPrefixFast: CallableRulesetPathResult | undefined;
    let mixinNamespaceFast: MixinEntry[] | undefined;
    let rulesetNamespaceUnion: MixinEntry[] | undefined;
    if (mixinFilterType !== 'Mixin') {
      // For an emitting call the head namespace may also exist in mixin form; the
      // ruleset walk then defers (returns undefined) but the collector captures its
      // ruleset-form prefix defs in the SAME pass so they union with the mixin path
      // below — same-named ruleset and mixin namespaces both contribute their
      // descendant output. Value lookups keep override semantics (no collector).
      const despiteMixinNamespaceOut: { entries?: MixinEntry[] } | undefined =
        options.mixinCall === true ? {} : undefined;
      const rulesetNamespaceFast = this.findRulesetNamespacePathFast(
        keys,
        options,
        0,
        despiteMixinNamespaceOut
      );
      if (rulesetNamespaceFast !== undefined) {
        if (rulesetNamespaceFast.length > 0) {
          return rulesetNamespaceFast;
        }
        // The ruleset-form walk hit a DEFINITE MISS at this scope (a same-named
        // local namespace exists but does not define the member). Drain the import
        // fallback before conceding: an imported same-named namespace may define
        // the member (`#library.add-one`, defined only in the import). A local hit
        // never reaches here, so this only ADDS resolution the primary walk missed.
        return this.drainNamespacePathFallback(keys, filterType, options);
      }
      if (despiteMixinNamespaceOut?.entries !== undefined && despiteMixinNamespaceOut.entries.length > 0) {
        rulesetNamespaceUnion = despiteMixinNamespaceOut.entries;
      }
      let namespaceMixins: MixinEntry[] | undefined;
      let namespaceMixinMissCovered = false;
      if (this._scopeFrame) {
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
      if (namespaceMixins === undefined && !namespaceMixinMissCovered) {
        if (options.searchParents === false) {
          const uncoveredChildNamespaceMixins = this.findMixinsFastForUncoveredCallable(
            keys[0]!,
            'child-surface',
            false,
            options
          );
          if (uncoveredChildNamespaceMixins !== UNCOVERED_CALLABLE_UNSUPPORTED) {
            namespaceMixins = uncoveredChildNamespaceMixins;
            namespaceMixinMissCovered = true;
          }
        }
      }
      if (
        namespaceMixins === undefined
        && !namespaceMixinMissCovered
        && !this._scopeFrame
      ) {
        namespaceMixins = this.findMixinsFast(keys[0]!, {
          hasTarget: options.hasTarget,
          local: options.local,
          includeRulesets: false
        });
      }
      if (!namespaceMixins || namespaceMixins.length === 0) {
        if (!namespaceMixinMissCovered && options.terminalMixinOnly !== true) {
          const namespaceRulesets = this.findCallableRulesetPath([keys[0]!], {
            hasTarget: options.hasTarget,
            local: options.local
          });
          if (namespaceRulesets.length !== 0) {
            // A LOCAL ruleset-form namespace owns the head (`#library { .sizes() }`)
            // so this mixin walk defers to the ruleset path (which already ran and
            // missed the member locally). Before conceding, drain the import
            // fallback: an imported same-named namespace may define the member the
            // local one does not (`#library.add-one`, defined only in the import).
            return this.drainNamespacePathFallback(keys, filterType, options);
          }
          const exactRulesetPath = this.findCallableRulesetPath(keys, {
            hasTarget: options.hasTarget,
            local: options.local
          });
          if (exactRulesetPath.length > 0) {
            return exactRulesetPath;
          }
        }
        return this.drainNamespacePathFallback(keys, filterType, options);
      }
      compoundPrefixFast = this.findCompoundPrefixPath(keys, options);
      mixinNamespaceFast = this.findCallableDescendants(
        namespaceMixins,
        keys,
        options
      );
    }
    const fast = mixinNamespaceFast ?? this.findMixinNamespacePathFast(keys, mixinFilterType, options);
    let combined: MixinEntry[] | undefined;
    let combinedOwned = false;
    if (compoundPrefixFast !== undefined && compoundPrefixFast.entries.length > 0) {
      combined = compoundPrefixFast.entries;
      combinedOwned = compoundPrefixFast.owned;
      if (fast !== undefined && fast.length > 0) {
        if (!combinedOwned) {
          combined = [...combined];
          combinedOwned = true;
        }
        for (let i = 0; i < fast.length; i++) {
          combined.push(fast[i]!);
        }
      }
    } else if (fast !== undefined && fast.length > 0) {
      combined = fast;
    }
    if (rulesetNamespaceUnion !== undefined) {
      // Ruleset-form namespace defs precede the mixin-form defs in source order.
      if (combined === undefined) {
        return rulesetNamespaceUnion;
      }
      const merged = [...rulesetNamespaceUnion];
      for (let i = 0; i < combined.length; i++) {
        merged.push(combined[i]!);
      }
      return merged;
    }
    // FALLBACK-FRAME DRAIN (namespace path). The head-namespace resolvers above
    // consult only `this`'s primary scope chain, so a namespace whose head is
    // defined ONLY on an imported fallback frame (`linkImportFallbackFrame`) — or
    // a member (`#library.add-one`) that a same-named LOCAL namespace does not
    // define — is invisible once the primary walk exhausts. Mirror the string-key
    // `findMixin` drain: AFTER the primary walk misses, re-run the SAME path
    // against each fallback frame's rulesNode so an imported namespace resolves
    // (byte-identical to the eval path, whose `findMixin` already drains fallback).
    // Fallbacks are consulted only when the primary walk found nothing, so a local
    // hit always wins. Zero-cost when no fallback frame is linked (the common
    // case — the guard bails before touching the chain).
    if (combined === undefined || combined.length === 0) {
      const drained = this.drainNamespacePathFallback(keys, filterType, options);
      if (drained !== undefined) {
        return drained;
      }
    }
    return combined;
  }

  /**
   * FALLBACK-FRAME DRAIN for a namespace path (`#library.add-one`). The
   * head-namespace resolvers in `findMixinPath` consult only `this`'s primary
   * scope chain, so a namespace member defined ONLY on an imported fallback frame
   * (`linkImportFallbackFrame` / `wireSpineImports`) — including a member a
   * same-named LOCAL namespace does not define — is invisible once the primary
   * walk exhausts. Mirrors the string-key `findMixin` fallback drain: re-run the
   * SAME path against each fallback frame's rulesNode AFTER the primary walk
   * misses, so a local hit always wins and an imported namespace still resolves
   * (byte-identical to the eval path, whose `findMixin` already drains fallback).
   *
   * Zero-cost when no fallback frame is linked (the common case): the guard bails
   * before allocating anything or touching the chain. Returns `undefined` when no
   * fallback frame produced a match (the caller keeps its own miss verdict).
   */
  private drainNamespacePathFallback(
    keys: string[],
    filterType: string | undefined,
    options: CallableFindOptions
  ): MixinEntry[] | undefined {
    const primaryFrame = this._scopeFrame;
    if (!primaryFrame) {
      return undefined;
    }
    // Gather the fallback heads reachable from the primary scope chain, in
    // encounter order (parent-chain first) — mirrors the string-key `findMixin`
    // drain. The fallback link installed by `linkImportFallbackFrame` hangs off
    // the frame that OWNED the import (often an ENCLOSING frame, not the leaf
    // lookup scope), so the leaf's own `.fallbackFrame` may be undefined while an
    // ancestor carries the imported surface. Walking parents only when
    // `searchParents` is on keeps a `local`/no-parent lookup zero-extra-cost.
    const fallbackHeads: ScopeFrame[] = [];
    let cursor: ScopeFrame | undefined = primaryFrame;
    const searchParents = options.searchParents !== false;
    while (cursor) {
      let head: ScopeFrame | undefined = cursor.fallbackFrame;
      while (head) {
        fallbackHeads.push(head);
        head = head.fallbackFrame;
      }
      if (!searchParents) {
        break;
      }
      cursor = cursor.parent;
    }
    if (fallbackHeads.length === 0) {
      return undefined;
    }
    const noParentOptions: CallableFindOptions =
      options.searchParents === false ? options : { ...options, searchParents: false };
    for (let i = 0; i < fallbackHeads.length; i++) {
      const fallbackFrame = fallbackHeads[i]!;
      if (isNode(fallbackFrame.rulesNode, N.Rules)) {
        const fallbackMatches = fallbackFrame.rulesNode.findMixinPath(
          keys,
          filterType,
          noParentOptions
        );
        if (fallbackMatches !== undefined && fallbackMatches.length > 0) {
          return fallbackMatches;
        }
      }
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
    while (rules) {
      const fn = rules.functionsByName?.get(keys);
      if (fn || !searchParents) {
        return fn;
      }

      do {
        let parent: Node | undefined = rules.parent;
        rules = undefined;
        while (parent) {
          if (isNode(parent, N.Rules)) {
            rules = parent;
            break;
          }
          parent = parent.parent;
        }
        const rulesParent = rules?.parent;
        if (findRoot && rules?.type === 'Rules' && rulesParent === undefined) {
          break;
        }
        if (isNonClassicImportBoundary(rules)) {
          findRoot = true;
        }
      } while (!findRoot && rules && rules.type !== 'Rules');
    }
    // The `.parent` walk dead-ends when the lookup starts inside a surface that
    // eval created but did not node-parent into the tree — a THIN control body
    // (For/If/While), an @media/@supports body eval frame, or a called detached
    // ruleset. Plugin/global functions (`range`, `length`, …) are registered on
    // the tree root, so fall back to it: JS functions live in one global
    // namespace, and any locally-bound function would have been found on the
    // parent walk above before we reach here.
    if (searchParents && options?.context) {
      const root = options.context.root;
      if (root && root !== this) {
        return root.functionsByName?.get(keys);
      }
    }
    return undefined;
  }

  override toString(options?: PrintOptions): string {
    if (!this.visible) {
      return '';
    }
    return this._toDocumentString(options);
  }

  _toDocumentString(rawOptions?: PrintOptions): string {
    if (!this.visible) {
      return '';
    }
    const options = getPrintOptions(rawOptions);
    const w = options.writer!;
    const depth = options.depth!;
    const mark = w.mark();

    const ctx = options.context;
    const hoistedLeadingComments = new Set<Node>();
    const saved = savePrintState(options, ['referenceMode', 'referenceRenderEnabled']);
    const ownReferenceMode = this.options.referenceMode === true;
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
          // Already emitted above; exclude from the body render-list instead of
          // mutating F_VISIBLE (which must stay a by-type property).
          hoistedLeadingComments.add(node);
        }
      }
      // @import must come after @charset but before other rules
      if (ctx?.topImports?.length) {
        for (const importRule of ctx.topImports) {
          if (isNode(importRule, N.AtRule)) {
            const importPrelude = importRule.prelude;
            if (importPrelude && typeof importPrelude !== 'string' && String(importPrelude.valueOf?.() ?? '').includes('$')) {
              const maybePrelude = importPrelude.eval(ctx);
              if (!isThenable<Node>(maybePrelude) && isNode(maybePrelude)) {
                importRule.prelude = maybePrelude;
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

    this._emitRulesBody(options, 'source', hoistedLeadingComments);
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
      result = w.getSince(mark).trimEnd();
      // Ensure exactly one trailing newline (only if there's content)
      result = result ? result + '\n' : '';
    } else {
      result = w.getSince(mark);
    }
    restorePrintState(options, saved);
    return result;
  }

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
    super();
    setSourceSpan(this, location);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    this._options = mergedOptions as unknown as typeof this._options;
    // Invariant 7: store, don't adopt. `parentChildren()` (called by the factory)
    // parents the rules one level.
    this.rules = value ?? [];
    this._sourceRoot = this;
    this._treeContext = treeContext;
    for (let i = 0; i < this.rules.length; i++) {
      if (hasCarriedMergeOutputSurface(this.rules[i]!)) {
        this.hasMergeOutputSurface = true;
        break;
      }
    }
    // Rules and every container subclass (Ruleset, AtRule, Mixin, If/For/While,
    // Stylesheet, Collection) are valid statements in a rules body.
    this.addFlag(F_ALLOW_ROOT);
  }

  /**
   * Rebuild the carried merge fact after a caller replaces or removes entries
   * in the body array. Ordinary append/derive paths carry the bit as they add
   * children; this bounded repair is only for destructive array rewrites.
   */
  refreshMergeOutputSurface(): void {
    this.hasMergeOutputSurface = false;
    for (let i = 0; i < this.rules.length; i++) {
      if (hasCarriedMergeOutputSurface(this.rules[i]!)) {
        this.hasMergeOutputSurface = true;
        break;
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

  private _emitSourceRulesBody(options: FinalPrintOptions): void {
    this._emitRulesBody(options, 'source');
  }

  private _emitRenderRulesBody(options: FinalPrintOptions): MaybePromise<void> {
    return this._emitRulesBody(options, 'render');
  }

  /**
   * Fold a root-level spine-foldable `@import` (IMPORTS increment 1). Drives
   * `StyleImport.resolveForSpine` (which queues a CSS-passthrough import to the
   * top-of-doc emitter, or `getTree`s a Less import's parsed body as an import-site
   * placement), then:
   *   - `css` → emit nothing inline (queued),
   *   - `fold` + spine-simple body → descend each imported child INLINE via the
   *     enclosing `emitNode`, with `context.rulesContext` pinned to the placement
   *     frame so an imported leaf resolves up the import chain (§2 frame thread),
   *   - `fold` + non-simple body → the byte-identical eval fall-back: render the
   *     import node the eval way (`render` → `evalNode`) and emit its output.
   */
  private _emitSpineImportFold(
    importNode: StyleImport,
    options: FinalPrintOptions,
    context: Context,
    emitNode: (n: Node) => MaybePromise<void>
  ): MaybePromise<void> {
    const w = options.writer!;
    // ISOLATE per-import context, mirroring `wireSpineImportsInBody`'s discipline:
    // emitting an import (fold descent OR the `evalFallback` → `evalNode`/`finalize`
    // path) transiently switches `context.treeContext`/`depth` while descending a
    // nested imported file (e.g. `_mixins` importing `vendor/_rfs`). Without a
    // snapshot+restore around EACH import emit, a deeply-nested import leaves its
    // file's `treeContext` in place, so the NEXT sibling import at this level
    // resolves its RELATIVE path against the wrong directory (bootstrap's
    // `@import "_reboot"` after `_mixins` pulled in `vendor/_rfs` → resolved from
    // `less/vendor` → File not found). Restore on every exit path (sync + async).
    const savedTreeContext = context.treeContext;
    const savedDepth = context.depth;
    const restoreImportContext = <T>(value: T): T => {
      context.treeContext = savedTreeContext;
      context.depth = savedDepth;
      return value;
    };
    const restoreThenRethrow = (error: unknown): never => {
      restoreImportContext(undefined);
      throw error;
    };
    const withRestore = (step: MaybePromise<void>): MaybePromise<void> =>
      isThenable(step)
        ? step.then(restoreImportContext, restoreThenRethrow)
        : restoreImportContext(step);
    const foldBody = (body: Rules, multiple: boolean, reference: boolean): MaybePromise<void> => {
      assignSpineChildIndices(body);
      const savedRulesContext = context.rulesContext;
      context.rulesContext = body;
      const restore = <T>(value: T): T => {
        context.rulesContext = savedRulesContext;
        return value;
      };
      // A `(reference)` import descends the placement AS A CHILD `Rules` (increment 5),
      // NOT by splicing its children: the `isChildRules` emit branch reads the
      // placement's own `options.referenceMode` (set in `_foldLessImportForSpine`) and
      // gates output via the container serializer's `renderEnabled` — a plain
      // ruleset/decl emits nothing, while an EXTEND-reached selector still emits.
      // Scope registration already ran (wire pass), so consumers resolve regardless.
      // A non-reference import splices its children directly (ordering + dedup + frame
      // exactly as increments 1–4).
      const emitReference = (): MaybePromise<void> => emitNode(body);
      const children = body.rules;
      const emitChild = (i: number): MaybePromise<void> => {
        for (let idx = i; idx < children.length; idx++) {
          const step = emitNode(children[idx]!);
          if (isThenable(step)) {
            return step.then(() => emitChild(idx + 1));
          }
        }
        return undefined;
      };
      // A `multiple` import's body descends inside a MULTIPLE scope, so its NESTED
      // imports also re-emit (no `once` dedup) — mirrors `inMultipleImportScope`.
      try {
        const step = withSpineMultipleScope(options, multiple, () => reference ? emitReference() : emitChild(0));
        return isThenable(step)
          ? step.then(restore, (error: unknown) => {
              restore(undefined);
              throw error;
            })
          : restore(step);
      } catch (error) {
        restore(undefined);
        throw error;
      }
    };
    const evalFallback = (): MaybePromise<void> => {
      // Byte-identical eval terminal for a non-simple imported body: render the
      // import node the eval way and splice its output text at this position.
      // ISOLATE its print-state: `importNode.render` → `evalForRender` →
      // `prepareRenderPrintState` RESETS `context.printState` IN PLACE (fresh writer +
      // frame arrays); in the single-pass spine render that IS the live emit state, so
      // an un-isolated fallback swaps the live writer/frames and every LATER sibling
      // writes into the discarded writer and is LOST (bootstrap: an imported body with
      // a DETACHED-RULESET-arg mixin call — `a { #hover({…}) }` in `_reboot` — is not
      // spine-foldable and lands here; its render silently dropped the entire following
      // `_grid` import). The render returns its own string (spliced into `w` below), so
      // isolate exactly as the value-leaf / guard resolves do.
      const position = w.position();
      const rendered = evalIsolatingSpinePrintState(context, () => importNode.render(context, getPrintOptions(options)));
      const finishRendered = (text: string): void => {
        if (w.position() === position && text) {
          w.add(text, importNode);
        }
      };
      return isThenable(rendered) ? rendered.then(finishRendered) : finishRendered(rendered);
    };
    // Reuse the placement the wire pass already resolved + registered + frame-linked
    // (IMPORTS increment 2/3), so the import is resolved once and its OUTPUT descends
    // against the SAME scope its consumers see. Every foldable import (root + nested)
    // is pre-wired, so `cached` is expected; the fresh-resolve below is a defensive
    // fallback for a lone import the wire pass didn't reach (no dedup — it is its own
    // only occurrence).
    const cached = options.spineImportPlacements?.get(importNode);
    if (cached) {
      if (cached.kind === 'css') {
        return undefined;
      }
      // DEDUP (increment 4): a `dedupe` re-import's scope is already registered/linked
      // by the wire pass; emit NO output (Less `once`). Otherwise fold its body.
      if (cached.dedupe) {
        return undefined;
      }
      return withRestore(isSpineFoldableImportBody(cached.body, options.spineExtendHeaders !== undefined) ? foldBody(cached.body, cached.multiple, cached.reference) : evalFallback());
    }
    const applyFresh = (resolved: SpineImportResolution): MaybePromise<void> => {
      if (resolved.kind === 'css') {
        return undefined;
      }
      // Consult the once-dedup ledger even on the fresh path (a not-pre-wired import,
      // e.g. one nested INSIDE another imported file): a re-import of an already-emitted
      // path is scope-only. `multiple`/`once:false` always emits.
      if (spineImportDedupeVerdict(resolved.resolvedPath, resolved.multiple, options)) {
        return undefined;
      }
      return isSpineFoldableImportBody(resolved.body, options.spineExtendHeaders !== undefined) ? foldBody(resolved.body, resolved.multiple, resolved.reference) : evalFallback();
    };
    const resolution = importNode.resolveForSpine(context);
    return withRestore(isThenable(resolution) ? resolution.then(applyFresh) : applyFresh(resolution));
  }

  /**
   * Fold a `$for`/`each` (`For`) loop reached by the ROOT / import-splice emitter
   * (`emitNode`) into per-iteration bound-body surfaces — the emitter-side analogue
   * of the CONTAINER descent's `runSpineForExpansion` (`serialize-helper`). Drive
   * `For.spineIterationSurfaces` (one surface per iteration, each holding COPIES of
   * the loop body under a fresh scope frame carrying the iteration's
   * `@value`/`@key`/counter bindings), then re-`emitNode` each surface's children
   * with `context.rulesContext` PINNED to that surface's frame so a body reference
   * OR a nested ruleset's interpolated selector (`.alert-@{color}`) resolves the loop
   * variable against the live iteration frame — across the async settle of the
   * surface build (`spineIterationSurfaces` evals the iterable). Pin is re-asserted
   * synchronously immediately before each child's `emitNode` (which enters the child
   * container serializer and captures `context.rulesContext` before any await), and
   * restored on every exit edge (sync + async). The surface build is wrapped in
   * `evalIsolatingSpinePrintState` so its value evals leave the live emit print-state
   * byte-identical (mirrors the container fold).
   */
  private _emitSpineForFold(
    forNode: Node,
    context: Context,
    emitNode: (n: Node) => MaybePromise<void>
  ): MaybePromise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- type-string narrows to For; only For exposes spineIterationSurfaces.
    const iterable = forNode as unknown as { spineIterationSurfaces(ctx: Context): Promise<Rules[]> };
    const surfacesResult = evalIsolatingSpinePrintState(context, () => iterable.spineIterationSurfaces(context));
    const applySurfaces = (surfaces: Rules[]): MaybePromise<void> => {
      const emitSurface = (s: number): MaybePromise<void> => {
        for (let si = s; si < surfaces.length; si++) {
          const surface = surfaces[si]!;
          const children = surface.rules;
          const emitChild = (c: number): MaybePromise<void> => {
            for (let ci = c; ci < children.length; ci++) {
              const savedRulesContext = context.rulesContext;
              context.rulesContext = surface;
              let step: MaybePromise<void>;
              try {
                step = emitNode(children[ci]!);
              } catch (error) {
                context.rulesContext = savedRulesContext;
                throw error;
              }
              if (isThenable(step)) {
                const nextIndex = ci + 1;
                return step.then(
                  () => {
                    context.rulesContext = savedRulesContext;
                    return emitChild(nextIndex);
                  },
                  (error: unknown) => {
                    context.rulesContext = savedRulesContext;
                    throw error;
                  }
                );
              }
              context.rulesContext = savedRulesContext;
            }
            return undefined;
          };
          const surfaceStep = emitChild(0);
          if (isThenable(surfaceStep)) {
            const nextSurface = si + 1;
            return surfaceStep.then(() => emitSurface(nextSurface));
          }
        }
        return undefined;
      };
      return emitSurface(0);
    };
    return isThenable(surfacesResult) ? surfacesResult.then(applySurfaces) : applySurfaces(surfacesResult);
  }

  private _emitRulesBody(options: FinalPrintOptions, mode: 'source', exclude?: Set<Node>): void;
  private _emitRulesBody(options: FinalPrintOptions, mode: 'render', exclude?: Set<Node>): MaybePromise<void>;
  private _emitRulesBody(options: FinalPrintOptions, mode: 'source' | 'render', exclude?: Set<Node>): MaybePromise<void> {
    const w = options.writer!;
    const context = options.context;
    const depth = options.depth ?? 0;
    const space = indent(depth);
    const value = this.rules;
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
      return isNode(node, N.Ruleset) || (isNode(node, N.AtRule) && node instanceof Rules && Boolean(node.rules));
    };

    let emittedCount = 0;
    let lastEmittedType: string | undefined;
    let lastEmittedWasInlineSourceRules = false;
    const emitBoundaryIfNeeded = (n: Node) => {
      if (emittedCount === 0 && !w.lastEmitWasInlineSource) {
        return;
      }
      const needsInlineBoundarySpacing = (
        (lastEmittedType === 'Any' && n.type !== 'Any')
        || (lastEmittedWasInlineSourceRules && n.type !== 'Any')
        // The inline-source predecessor may have been emitted by a DEEPER closure
        // (an `(inline)` `@import` spliced through a nested import-fold): its
        // per-closure inline-source state never reaches THIS body's `emitNode`, so
        // the writer carries a document-global flag set whenever inline-source text
        // was the last thing emitted. A following non-inline block gets the same
        // post-inline blank-line separator eval emits. Cleared once consumed below.
        || (w.lastEmitWasInlineSource && n.type !== 'Any')
      );
      // Consume the document-global inline-source flag: the boundary decision for
      // THIS node is the only place it matters; leaving it set would inject a
      // spurious blank before the node AFTER this one.
      w.lastEmitWasInlineSource = false;
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
      // Document-global inline-source flag (survives import-fold closure nesting):
      // set true only when the just-emitted node is inline-import RAW source (an
      // `Any` role-`any` leaf), false otherwise. A wrapper/container must not set
      // this bit: a postlude `@media` can itself have a single raw child, but its
      // closing boundary is already the inline source's own boundary.
      // following top-level block reads it in `emitBoundaryIfNeeded` and inserts
      // the post-inline blank line even when the inline text came from a deeper closure.
      w.lastEmitWasInlineSource = isNode(n, N.Any) && n.role === 'any';
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
      this.options.referenceMode === true
      && options.referenceMode !== true
    ) {
      options.referenceMode = true;
    }
    const emitNode = (n: Node): MaybePromise<void> => {
      const isEvaluatedDefinitionNode = mode !== 'syntax' && isNode(n, N.Mixin | N.VarDeclaration);
      if (
        isEvaluatedDefinitionNode
        && !hasPrintableTriviaAt(n, 'before', options)
        && !hasPrintableTriviaAt(n, 'after', options)
      ) {
        return;
      }
      if (exclude?.has(n) || !n.visible) {
        emitLeadingBlockCommentForNode(n);
        return;
      }
      // Spine import-fold at the ROOT body (cutover IMPORTS increment 1,
      // UNIFIED-EVAL-EMIT-DESIGN §2/§4.0). A root-level `@import` reaches this leaf
      // branch (not the container serializer's `runSpineImportExpansion`), so fold
      // it HERE: resolve, then either drop (CSS-passthrough → queued top-of-doc) or
      // descend the parsed imported body's children INLINE by re-`emitNode`-ing each
      // with `context.rulesContext` pointed at the import-site placement frame — the
      // same shared-body/frame-thread discipline `spineFrame` applies nested. No
      // `rules.eval()`, no output tree (ratchet: `Rules.derive` = 0). A non-simple
      // imported body falls through to the eval terminal below (byte-identical).
      if (mode === 'render' && context && options.spineMode && isSpineFoldableImport(n) && isStyleImportRegistrationNode(n)) {
        return this._emitSpineImportFold(n, options, context, emitNode);
      }
      // Bodyless CSS `@import` STATEMENT (`AtRuleStatement`, e.g. `@import "x.css"
      // screen;` or `@import url(...) layer(foo);`). Eval hoists it to the top-of-doc
      // emitter via `prepareRegistration` → `queueTopImport` (see below); the spine
      // does the SAME here so it prepends in document order rather than emitting at
      // its authored source position (which may follow a `@media`/`@layer` block).
      // `renderRootViaSpine` flushes `context.topImports` ahead of the body. Only a
      // static prelude reaches here (`isSpineFoldableCssImportStatement`).
      if (mode === 'render' && context && options.spineMode && isSpineFoldableCssImportStatement(n) && isAtRuleStatementNode(n)) {
        queueTopImport(context, n);
        return;
      }
      // A root `@charset "utf-8";` (role-'charset' `Any`) HOISTS to document top on
      // the spine, mirroring eval (`prepareRegistration` sets `currentCharset` + the
      // depth-0 `_toDocumentString` emits it first). Register the FIRST as
      // `currentCharset` and drop it here — `renderRootViaSpine` prepends the charset
      // prelude ahead of imports. A later duplicate charset registers nothing and
      // emits nothing (byte-identical to eval's single hoisted charset).
      if (mode === 'render' && context && options.spineMode && isNode(n, N.Any) && n.role === 'charset') {
        context.currentCharset ??= n;
        return;
      }
      // LOOP fold at the ROOT / IMPORT-SPLICE emitter (cutover LOOP increment 1,
      // ROOT parity). A `$for`/`each` (`For`) node reaching THIS emitter — a root-
      // direct loop, or a loop inside an imported body spliced here via
      // `_emitSpineImportFold` — must expand into its per-iteration bound surfaces
      // exactly as the CONTAINER descent does (`serializeRulesContainerInternal` →
      // `runSpineForExpansion`). Without this it falls to the `isChildRules` branch
      // below, which emits the loop body ONCE, UNBOUND — a nested ruleset's
      // interpolated selector (`.alert-@{color}`) then resolves the loop variable
      // against a frame that never bound it (`'color' is not defined`). Route it
      // through the shared iteration-surface fold: each surface's children re-enter
      // `emitNode` with `context.rulesContext` pinned to that surface's live frame,
      // so a body reference / interpolated selector resolves the iteration binding.
      if (mode === 'render' && context && options.spineMode && n.type === 'For') {
        return this._emitSpineForFold(n, context, emitNode);
      }
      const isContainer = n.type === 'Ruleset' || n.type === 'AtRule' || n.type === 'Rules';
      if (isContainer && n.type === 'Rules') {
        emitLeadingBlockCommentForNode(n);
      }
      if (referenceMode && !referenceRenderEnabled && !isContainer) {
        return;
      }
      const isRulesetOrAtRule = isBlockContainer(n);
      const isChildRules = !isRulesetOrAtRule && isNode(n, N.Rules);
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
          : finishChildRule();
      }
      if (isRulesetOrAtRule) {
        emitLeadingBlockCommentForNode(n);
        emitBoundaryIfNeeded(n);
        const position = w.position();
        const containerSaved = savePrintState(options, ['depth', 'referenceMode', 'referenceRenderEnabled']);
        options.depth = depth;
        options.referenceMode = referenceMode;
        options.referenceRenderEnabled = referenceRenderEnabled;
        // A container child that routes to EVAL render (`n.render` → `evalForRender`
        // → `prepareRenderPrintState`) RESETS `context.printState` IN PLACE (fresh
        // writer + frame arrays). In the single-pass spine render `context.printState`
        // IS the live emit state, so an un-isolated eval render swaps the live
        // writer/frame-arrays and every LATER sibling then writes into the discarded
        // writer and is LOST (bootstrap: `a { #hover({…}) }` — a mixin call with a
        // DETACHED-RULESET arg is deferred to eval; its render dropped the entire
        // following `_grid` block). `n.render` returns its OWN rendered string
        // (spliced into `w` below), so isolate its print-state side effect exactly as
        // the value-leaf / guard resolves do (`evalIsolatingSpinePrintState`), leaving
        // the live writer/frames byte-identical for the next sibling. The
        // `serializeRulesContainerInline` (spine) branch never resets print-state.
        const rule = mode === 'render' && context
          ? (options.spineMode
              ? evalIsolatingSpinePrintState(context, () => n.render(context, getPrintOptions(options)))
              : n.render(context, getPrintOptions(options)))
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
      // ROOT-DIRECT statement-position FUNCTION call (`e('…');`) fold. Mirrors the
      // CONTAINER path's `finishLeaf` (serialize-helper): evaluate + serialize the
      // resolved value inline, DROP the source `requiredSemi` `;` (eval emits the
      // value/void with no trailing `;`), suppress a void result. The resolved node is
      // first run through `checkValidNodes` at ROOT (`F_ALLOW_ROOT`) so a value-returning
      // call that resolves to a non-statement node (`rgba(0,0,0,0);` → a `Color`) throws
      // `eval/invalid-statement` exactly as the eval terminal did — a legal statement
      // node (`e('…')` → an `Anonymous`) passes. Byte-identical to the eval terminal that
      // previously handled this at root, so the root gate no longer forces it to eval.
      if (mode === 'render' && context && options.spineMode && isSpineFoldableStatementCall(n)) {
        const resolvedNode = resolveSpineStatementCallNode(n, options);
        const finishStatementCall = (resolved: Node | Nil | undefined): void => {
          restorePrintState(options, leafSaved);
          if (this === context.root && resolved && !(resolved instanceof Nil)) {
            checkValidNodes([resolved], context, true, false);
          }
          const trimmed = serializeSpineStatementCallNode(resolved, options).trim();
          if (!trimmed) {
            w.restore(leafMark);
            return;
          }
          w.add(trimmed, n);
          w.add('\n');
          markEmitted(n);
        };
        return isThenable(resolvedNode)
          ? resolvedNode.then(finishStatementCall)
          : finishStatementCall(resolvedNode);
      }
      // A document-ROOT-level mixin CALL: mark the drive so the callable terminal
      // rejects a body that drops a bare property at the root (eval-path parity with
      // `checkValidNodes`' `isRoot && fromCallOutput` rule; the spine emits the call
      // as text with no output tree to walk post-hoc). Scoped to this render only —
      // a call nested in a selector container never sets it (folded property legal).
      const marksRootCallEmit = mode === 'render'
        && options.spineMode === true
        && !!context
        && this === context.root
        && isSpineEligibleMixinCall(n);
      const savedRootCallEmit = context?.spineRootCallEmit;
      const savedRootCallEmitFrame = context?.spineRootCallEmitFrame;
      const restoreRootCallEmit = (): void => {
        if (marksRootCallEmit) {
          context!.spineRootCallEmit = savedRootCallEmit;
          context!.spineRootCallEmitFrame = savedRootCallEmitFrame;
        }
      };
      if (marksRootCallEmit) {
        context!.spineRootCallEmit = true;
        // Capture the TRUE source-root caller frame for leaky injection: `this` is
        // the root here (`this === context.root`), but the nested call eval below
        // reassigns `context.root`, so a later injection can't recover it.
        context!.spineRootCallEmitFrame = this;
      }
      // ROOT-LEVEL mixin CALL fold (cutover P4, UNIFIED-EVAL-EMIT-DESIGN §2/§3). A
      // document-root-direct mixin call (`.m();`) folds through the SAME
      // `resolveSpineMixinCall` sink the CONTAINER descent uses — driving the call's
      // resolution ONCE and, when every guard-passed candidate was spine-simple,
      // emitting each bound surface's children INLINE (no output tree, `Rules.derive`
      // = 0). A nested-container surface child (`.m() { .test { … } }`) descends via
      // `Ruleset.render`'s spineMode branch (`serializeRulesContainer`), a leaf via
      // `n.render` — both against `context.rulesContext` pushed to the surface, so a
      // body reference resolves against the mixin's DEFINITION/param frame (increment
      // 2). A NON-simple body (or a call the sink never saw) resolves `kind:'eval'` and
      // falls through to the byte-identical eval terminal (`n.render`) below. This
      // closes the residual where a root call always eval-materialized while a
      // container-nested call already folded (the ONLY structural gap between the two).
      const emitEvalTerminal = (): MaybePromise<void> => {
        let output: string | MaybePromise<string>;
        try {
          output = n.render(context!, options);
        } catch (error) {
          restoreRootCallEmit();
          throw error;
        }
        const finishOutput = (resolvedOutput: string): void => {
          restoreRootCallEmit();
          restorePrintState(options, leafSaved);
          if (!w.hasContentSince(leafMark)) {
            w.restore(leafMark);
            if (resolvedOutput) {
              emitCaptured(resolvedOutput, n, prefix);
            }
            return;
          }
          // A spine-eligible mixin CALL that folded to BLOCK output (a nested-container
          // body — ends in `}`) must NOT append its own statement `;`: the expansion
          // supplies its own terminators, and a `;` after a `}` is spurious (`.m() { .x
          // {…} } … .m();` → `.x {…}` with no trailing `;`). A flat/decl-producing call's
          // decls carry their own `;`. Detect the block close on the just-emitted text.
          const emittedBlock = /\}\s*$/.test(w.getSince(leafMark));
          if (n.requiredSemi && n.options.semi !== false && !emittedBlock) {
            w.add(';', n);
          }
          markEmitted(n);
        };
        return isThenable(output)
          ? output.then(finishOutput, (error: unknown) => {
              restoreRootCallEmit();
              throw error;
            })
          : finishOutput(output);
      };
      if (marksRootCallEmit) {
        const applyResolution = (resolved: SpineMixinCallResolution): MaybePromise<void> => {
          // A NON-simple body (or a call the sink never saw) → byte-identical eval
          // terminal. No byte was written before the resolve (the drive is
          // side-effect free on the writer), so the terminal owns the emit intact.
          if (resolved.kind !== 'fold') {
            return emitEvalTerminal();
          }
          // FOLD: the call emits nothing itself; each bound surface's children emit
          // inline against `context.rulesContext` pushed to the surface (its wired
          // definition/param frame). Roll back the boundary/prefix so a block child
          // starts clean, exactly as the container path's fold splice.
          restoreRootCallEmit();
          restorePrintState(options, leafSaved);
          w.restore(leafMark);
          // LEAKY forward-propagation (spine fold, root parity): in leaky Less mode a
          // folded surface's plain `@x: …` VarDeclaration LEAKS into the CALLER scope
          // — here the ROOT — so a later root sibling (`.heightIsSet { height: @x }`,
          // a following call arg `@x`) reads it. Mirror the container path's
          // `injectSpineLeakyMixinSurfaceBindings` at the call's source index. Zero-cost
          // off leaky mode; no-ops when a surface has no plain var.
          if (context!.options.leakyScope === true && n.index !== undefined) {
            for (const surface of resolved.surfaces) {
              this.injectSpineLeakyMixinSurfaceBindings(surface, n.index, context!);
            }
          }
          // A bare property `Declaration` dropped at the ROOT by a mixin/DR call is
          // invalid Less ("Properties must be inside selector blocks"). The eval path
          // catches this in `checkValidNodes` (`isRoot && fromCallOutput`); the fold
          // emits no call-output tree to walk post-hoc, so run the SAME check over each
          // folded surface's children here — reproducing the exact error byte-for-byte
          // (tests-error/eval/property-in-root{,2}, detached-ruleset-3). A legitimate
          // root node (a nested `.rule {}`) passes; only a bare `Declaration` throws.
          for (const surface of resolved.surfaces) {
            checkValidNodes(surface.rules, context, true, true);
          }
          // Each folded surface child emits itself through `emitNode` (which calls
          // `markEmitted` on the child it emits); the CALL node itself emits nothing,
          // so no `markEmitted(n)` here — mirrors the container path where a folded
          // call contributes no node of its own to the boundary tracking.
          const savedCtx = context!.rulesContext;
          const emitChildren = (children: Node[], ci: number): MaybePromise<void> => {
            for (let c = ci; c < children.length; c++) {
              const res = emitNode(children[c]!);
              if (isThenable(res)) {
                return res.then(() => emitChildren(children, c + 1));
              }
            }
            return undefined;
          };
          const emitSurface = (s: number): MaybePromise<void> => {
            if (s >= resolved.surfaces.length) {
              context!.rulesContext = savedCtx;
              return undefined;
            }
            const surface = resolved.surfaces[s]!;
            context!.rulesContext = surface;
            const done = emitChildren(surface.rules, 0);
            const next = (): MaybePromise<void> => {
              context!.rulesContext = savedCtx;
              return emitSurface(s + 1);
            };
            return isThenable(done) ? done.then(next) : next();
          };
          return emitSurface(0);
        };
        const resolution = resolveSpineMixinCall(n, context!);
        return isThenable(resolution) ? resolution.then(applyResolution) : applyResolution(resolution);
      }
      // ROOT-BODY merge/`?:` fold (cutover root-fold, gates 3/4). A `+:`/`+_:`
      // merge or `@x ?: v` conditional-assign DIRECTLY in the root body is planned
      // by the `withSpineMergePlan` wrap installed at the root spine descent (below).
      // The plan is consumed by `resolveSpineLeafText` (the SAME leaf resolver the
      // container descent uses): a `suppress` member returns '' (no output); the
      // anchor / resolved-conditional returns its coalesced bytes. Unlike a plain
      // `n.render` leaf (which WRITES into the buffer and returns a fallback), the
      // resolver returns bytes WITHOUT writing — so a planned leaf is emitted here by
      // writing the returned text explicitly (empty ⇒ nothing, no stray `;`). This
      // matches the container path's `finishLeaf`. `setDefined` (gate 5) needs no
      // leaf hook: its binding-WRITE happens at body-enter in the wrap, and the
      // VarDeclaration itself emits nothing.
      const hasPlanEntry = options.spineMode && !!context
        && isNode(n, N.Declaration)
        && (options.spineMergePlan?.get(n) !== undefined || options.spineCondPlan?.get(n) !== undefined);
      if (hasPlanEntry) {
        const planned = resolveSpineLeafText(n, options);
        const finishPlanned = (text: string): void => {
          restorePrintState(options, leafSaved);
          // No content written yet (the resolver does not touch the buffer). Roll the
          // boundary/prefix back so a suppressed member leaves NO trace, then emit the
          // anchor/resolved text (with its own `;`) via the shared capture path.
          w.restore(leafMark);
          if (text) {
            emitCaptured(text, n, prefix);
          }
        };
        return isThenable(planned) ? planned.then(finishPlanned) : finishPlanned(planned);
      }
      return emitEvalTerminal();
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
      // ROOT-BODY `?:`/`setDefined` fold (cutover root-fold, gates 4/5). The
      // CONTAINER descent wraps each body in `withSpineMergePlan` (which runs the
      // `setDefined` binding-write at body-enter and installs the `?:` plan the leaf
      // resolver consumes). The root spine descent reaches the body HERE — not
      // through that wrap — so install the SAME plan machinery over the root body.
      // Scoped to the root spine body; a container/nested Rules descent (already
      // wrapped by the caller) is untouched. `withSpineMergePlan` fast-bails when
      // the body has no `?:`/`setDefined` child (a root-direct property MERGE is
      // gated OFF the spine — gate 3 residual — so the merge plan is never populated
      // at root). The common case pays a single pre-scan, no plan allocation, and
      // its return string is unused here — the emit is the `emitRest` side-effect.
      if (options.spineMode && context && this === context.root) {
        const wrapped = withSpineMergePlan(value, options, context, () => {
          const done = emitRest(0);
          return isThenable(done) ? done.then(() => '') : '';
        });
        return isThenable(wrapped) ? wrapped.then(() => undefined) : undefined;
      }
      return emitRest(0);
    }
    for (const n of value) {
      void emitNode(n);
    }
    finish();
  }

  override toTrimmedString(rawOptions?: PrintOptions) {
    const options = getPrintOptions(rawOptions);
    const w = options.writer!;
    const position = w.position();
    this.writeSyntax(options);
    return w.getSince(position);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    if (!this.visible) {
      return;
    }
    this._emitSourceRulesBody(options);
  }

  toRenderString(rawOptions?: PrintOptions): MaybePromise<string> {
    if (!this.visible) {
      return '';
    }
    const options = getPrintOptions(rawOptions);
    const w = options.writer!;
    const mark = w.mark();
    const rendered = this._emitRenderRulesBody(options);
    return isThenable(rendered)
      ? rendered.then(() => w.getSince(mark))
      : w.getSince(mark);
  }

  private evalForRender(context: Context, sourceWasRoot: boolean): MaybePromise<RulesRenderState> {
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
    // The effective PrintOptions is the 3rd arg in the buffer overload, else the
    // 2nd. Its `preSerializeRoot` hook (D3) runs the compiler's post-eval /
    // pre-render plugin visitors on the tree render just evaluated — the reason
    // the old separate eval pre-pass existed — so no second eval is needed.
    const printOptions = isRenderBuffer(bufferOrOptions) ? options : bufferOrOptions;
    const preSerializeRoot = sourceWasRoot ? printOptions?.preSerializeRoot : undefined;
    // Single-pass spine (P1): a spine-eligible root is rendered by ONE downward
    // descent of the source tree with the live value-frame threaded — no eval
    // pass, no `state.output` tree, no separate serialize walk. This REPLACES
    // the two-walk below for that shape; the eval→output-tree→serialize path is
    // not entered for it. (`preSerializeRoot` is a post-eval visitor hook — a
    // spine-eligible leaf-only root has no such consumer here; P2 folds the
    // visitor hook into the pass generically.)
    const serialize = (state: RulesRenderState): MaybePromise<string> => {
      checkValidNodes(state.output?.rules, context, sourceWasRoot);
      return isRenderBuffer(bufferOrOptions)
        ? writeRulesStateRenderOutput(bufferOrOptions, state, context, options)
        : renderRulesStateToString(state, context, bufferOrOptions);
    };
    const afterEval = (state: RulesRenderState): MaybePromise<string> => {
      if (!preSerializeRoot || !state.output) {
        return serialize(state);
      }
      const hooked = preSerializeRoot(state.output);
      const applyHook = (replaced: Rules | void): MaybePromise<string> =>
        serialize(replaced ? { ...state, output: replaced } : state);
      return isThenable(hooked) ? hooked.then(applyHook) : applyHook(hooked);
    };
    // The eval render path — reached directly when the root is not spine-eligible, OR as the
    // ABORT-TO-EVAL fall-back when the spine's post-wire re-gate rejects a speculatively-admitted
    // import+extend tree (import-spec routing). The abort has already reset the render context, so this
    // re-render produces exactly the byte-identical eval output.
    const evalPath = (): MaybePromise<string> => {
      const value = this.evalForRender(context, sourceWasRoot);
      return isThenable(value) ? value.then(afterEval) : afterEval(value);
    };
    if (sourceWasRoot && !preSerializeRoot && isSpineEligibleRoot(this, context, printOptions?.collapseNesting)) {
      const prepared = isRenderBuffer(bufferOrOptions)
        ? prepareBufferPrintState(context, printOptions, bufferOrOptions)
        : prepareRenderPrintState(context, printOptions);
      const shareFlatWriter = isRenderBuffer(bufferOrOptions)
        && bufferOrOptions.kind === 'flat'
        && prepared.writer.writesTo(bufferOrOptions.parts);
      const rendered = renderRootViaSpine(this, context, prepared, shareFlatWriter);
      // A spine render may ABORT to eval (a resolved sentinel, sync or via the async import chain). On
      // abort, `evalPath()` owns the WHOLE render including the buffer write (its `serialize` branches
      // on `isRenderBuffer`), so it must NOT be re-wrapped in `writeRenderTextResult` — that would write
      // the eval output into the buffer a SECOND time (double-emit). Only genuine spine TEXT is wrapped.
      const finishSpine = (result: string | typeof SPINE_ABORT_TO_EVAL): MaybePromise<string> => {
        if (result === SPINE_ABORT_TO_EVAL) {
          return evalPath();
        }
        // A shared spine writes its prelude and body directly into the compiler-owned
        // flat buffer. Re-wrapping the returned body would duplicate it; the returned
        // string remains the public render result, while the aliased writer owns the
        // buffer bytes already.
        if (shareFlatWriter) {
          return result;
        }
        return isRenderBuffer(bufferOrOptions)
          ? writeRenderTextResult(bufferOrOptions, result)
          : result;
      };
      return isThenable(rendered) ? rendered.then(finishSpine) : finishSpine(rendered);
    }
    return evalPath();
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
        if (!visibleOnly || n.visible) {
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
          let value = n.value;
          let { important } = n;
          let { name } = n;
          if (convertToPrimitives) {
            let primitive: string | number | boolean | undefined = value instanceof Node
              ? value.valueOf()
              : (Array.isArray(value) ? undefined : value);
            let outputValue = important ? `${primitive} ${important}` : primitive;
            if (outputValue === undefined) {
              continue;
            }
            output.set(name.toString(), outputValue);
          } else {
            let outputValue = important instanceof Node ? new Sequence([n, important]) : n;
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
      if (this._lookup) {
        this._lookup.callableFullIndex = undefined;
      }
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
        // A member-inlining import (`@import`, or `@compose (namespace: *)`) dumps its
        // declarations and callables into this scope as if written in place — like a
        // Less mixin call's ambient output. Rather than flatten the AST or slow every
        // lookup to the crawl, link the imported Rules' OWN scope frame (which already
        // indexes the imported decls) as this frame's fallback. `lookupScopeFrame*`
        // consults fallbacks only AFTER the primary scope chain, so an enclosing
        // declaration always wins (imported members never override), and the fast frame
        // path is preserved. Named `@compose` and nested rulesets keep their own scope.
        if (importInlinesMembersToParent(node)) {
          linkImportFallbackFrame(this._scopeFrame, node.getScopeFrame());
        }
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
       * `nearestOuter` (Jess `:=`) reassigns the nearest lexically-enclosing
       * scope that ALREADY binds the name, writing its runtime cell — a JS-block
       * `let`-reassignment walking OUTWARD (nearest-first). It NEVER creates a new
       * binding in the current scope (that is the contrast with `@x: v`), and a
       * name that no enclosing scope binds is a hard compile error (one error,
       * stop). Distinct from `setDefined` (Sass `!global`); shares the frame walk
       * because `lookupScopeFrameVariable` already returns the first (nearest)
       * hit up the parent chain. This fires only on a `:=` node, so the common
       * variable path pays nothing.
       */
      if (node.options?.nearestOuter && isNode(node, N.VarDeclaration)) {
        const key = node.name.toString();
        // `:=` on a name no enclosing scope binds is a hard compile error, with
        // this node's source location. One error, stop.
        const unbound = (): never => {
          throw ERR.nameNotFound({
            ctx: context?.treeContext?.file ? { file: context.treeContext.file } : undefined,
            node: { spanStart: spanStartOf(node), spanEnd: spanEndOf(node) },
            meta: { symbol: key }
          });
        };
        const frame = this._scopeFrame;
        if (frame) {
          const variableHit = lookupScopeFrameVariable(frame, key, {
            bailOnPendingDeclarations: true,
            // Exclude the `:=` node's own binding: the nearest enclosing target
            // must be a PRIOR binding, never the assignment itself.
            blockedSource: source => source === node,
            filter: source => source !== node,
            includeAssignmentTargets: true,
            searchParents: true
          });
          if (variableHit.kind === 'live' || variableHit.kind === 'declaration') {
            if (variableHit.readonly || variableHit.cell.readonly) {
              throw new ReferenceError(`"${key}" is readonly`);
            }
            variableHit.cell.value = evalSetDefinedAssignedValue(node, context);
            return;
          }
          if (variableHit.kind === 'miss') {
            unbound();
          }
          // kind === 'uncovered': the frame can't statically model this surface
          // (optional / dynamic targets). Fall to the occurrence crawl below,
          // which walks parents (searchParents: true) and writes the found cell.
        }
        const resultOccurrence = findWritableSetDefinedDeclarationOccurrence(
          this,
          key,
          true,
          // Exclude the `:=` node's own VarDeclaration: it must resolve to a PRIOR
          // enclosing binding, never itself (the crawl would otherwise match the
          // assignment node and fabricate a same-scope binding).
          { searchParents: true, excludedDeclarations: [node] }
        );
        const result = resultOccurrence?.node;
        const owner = result?.parent;
        if (result && isNode(result, N.VarDeclaration) && isNode(owner, N.Rules)) {
          owner.writeSetDefinedBindingCell(key, result, evalSetDefinedAssignedValue(node, context));
          return;
        }
        unbound();
      }
      /**
       * setDefined assigns through the resolved variable binding. Static
       * VarDeclaration writes stay in place; the fallback below still handles
       * older non-variable declaration placement behavior.
       */
      if (node.options?.setDefined) {
        const key = node.name.toString();
        // setDefined is an assignment, not a declaration: it overwrites the
        // existing binding's runtime value. That value lives in a per-scope
        // ScopeFrame cell, so the write stays isolated to this mixin invocation
        // / loop iteration. The AST node is a shared template reused across
        // every invocation — we must never mutate it here.
        if (isNode(node, N.VarDeclaration)) {
          // When this scope already has a frame, it models the live binding
          // chain (params, declaration cells, imported assignment targets), so
          // resolve through it without rebuilding or crawling source `rules`.
          const frame = this._scopeFrame;
          if (frame) {
            const variableHit = lookupScopeFrameVariable(frame, key, {
              bailOnPendingDeclarations: true,
              blockedSource: source => source === node,
              filter: source => source !== node,
              includeAssignmentTargets: true
            });
            if (variableHit.kind === 'live' || variableHit.kind === 'declaration') {
              if (variableHit.readonly || variableHit.cell.readonly) {
                throw new ReferenceError(`"${key}" is readonly`);
              }
              variableHit.cell.value = evalSetDefinedAssignedValue(node, context);
              return;
            }
            if (variableHit.kind === 'miss') {
              throw new ReferenceError(`"${key}" is not defined`);
            }
            // kind === 'uncovered': the frame can't model this assignment
            // surface (optional / dynamic targets). Fall to the occurrence
            // crawl, which resolves the owner Rules and writes its cell.
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
          const owner = result.parent;
          if (isNode(owner, N.Rules)) {
            // Write the existing binding cell on the owner scope. The cell is
            // the per-frame runtime value that reads dereference; we never
            // mutate the shared AST node, so mixin invocations / loop
            // iterations that reuse the same node stay isolated.
            owner.writeSetDefinedBindingCell(key, result, evalSetDefinedAssignedValue(node, context));
          }
          return;
        }

        // Find the Rules node that contains the found declaration
        if (!isNode(result.parent, N.Rules)) {
          throw new Error(`Could not find parent Rules for declaration '${key}'`);
        }
        const foundRules = result.parent;

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
        if (hasCarriedMergeOutputSurface(newDeclaration)) {
          foundRules.hasMergeOutputSurface = true;
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
          const newEntry = createVarDeclarationBindingEntry(node as VarDeclaration);
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

  /**
   * Leaky Less mode: register a mixin CALL's evaluated output declarations into
   * this caller frame at the call's source index, so a LATER sibling's variable
   * lookup resolves them while an earlier sibling (start-gated) still does not.
   * The output declarations otherwise only live on the output child Rules, which
   * the `full` scope-frame lookup does not consult.
   */
  injectLeakyMixinOutputBindings(output: Rules, callIndex: number): void {
    const frame = this._scopeFrame;
    const vars = output.varsByName;
    if (!frame || !vars) {
      return;
    }
    if (!isPublicRulesEntry({ node: output }, 'VarDeclaration')) {
      return;
    }
    for (const [name, entries] of vars) {
      const current = entries[entries.length - 1];
      if (!current) {
        continue;
      }
      const decl = current.sourceNode;
      decl.index = callIndex;
      injectFrameLeakBinding(frame, name, { cell: current.cell, sourceNode: decl });
    }
  }

  /**
   * Leaky Less mode, SPINE fold: register a FOLDED mixin surface's plain `@x: …`
   * VarDeclarations into this caller frame at the call's source index — the spine
   * analogue of {@link injectLeakyMixinOutputBindings}. Unlike the eval path the
   * surface is NOT pre-evaluated, so each leaked value is bound through a cell that
   * resolves the declaration's value against the SURFACE frame (its wired
   * lexical/param bindings), so a param-dependent leak (`@x: @a`) reads the bound
   * param, byte-identical to the less@4 leak (a shape jess EVAL itself throws on).
   * A `setDefined` (`!global`) decl is skipped — it writes an outer scope by its own
   * mechanism, not a forward leak. The binding lands on the caller frame's current
   * bindings, so a same-scope sibling (earlier OR later — Less resolves a scope's
   * vars lazily last-wins) resolves it; an out-of-scope sibling still sees the outer
   * binding. Zero surface vars ⇒ nothing injected.
   */
  injectSpineLeakyMixinSurfaceBindings(surface: Rules, callIndex: number, context: Context): void {
    const frame = this._scopeFrame;
    const rules = surface.rules;
    if (!frame || !isArray(rules)) {
      return;
    }
    for (let i = 0; i < rules.length; i++) {
      const decl = rules[i]!;
      if (
        !isNode(decl, N.VarDeclaration)
        || typeof decl.name !== 'string'
        || decl.options?.setDefined
      ) {
        continue;
      }
      const name = decl.name;
      // The leak's source-order gate keys on `sourceNode.index` = the CALL's index
      // in the caller. The surface `decl` is SHARED across calls (the fold copies
      // no nodes), and its OWN `index` is load-bearing for the body's intra-scope
      // reads (a `snapshot` ref compares against it) — so DO NOT mutate `decl.index`.
      // Use a prototype-delegating marker that overrides only `index`; identity /
      // filter / recursion checks still see the real decl through the chain.
      const gateNode: Node = Object.create(decl);
      gateNode.index = callIndex;
      const cell: BindingCell = {
        prepareValue: () => {
          const savedRulesContext = context.rulesContext;
          context.rulesContext = surface;
          try {
            const evaluated = decl.valueNode().eval(context);
            if (isThenable(evaluated)) {
              // A leaked value that resolves ASYNC (a thenable) is not supported by
              // the sync binding-cell read path. Fall back to the raw value node so
              // the caller resolves it against the surface frame at read time.
              return decl.valueNode();
            }
            return evaluated;
          } finally {
            context.rulesContext = savedRulesContext;
          }
        },
        sourceNode: gateNode
      };
      injectFrameLeakBinding(frame, name, { cell, sourceNode: gateNode });
    }
  }

  /**
   * Overwrite the runtime binding cell for an existing variable owned by this
   * scope, as resolved by the setDefined occurrence crawl. Prefers a built
   * frame's modeled cell (which also covers imported assignment targets);
   * otherwise updates the declaration-index cell directly without allocating a
   * scope frame. Never mutates the AST node — the cell is the per-frame value
   * that reads dereference, keeping reused mixin/loop bodies isolated.
   */
  private writeSetDefinedBindingCell(key: string, declaration: Node, value: Node): void {
    if (this._scopeFrame) {
      const hit = lookupScopeFrameVariable(this._scopeFrame, key, {
        includeAssignmentTargets: true,
        searchParents: false
      });
      if (hit.kind === 'live' || hit.kind === 'declaration') {
        hit.cell.value = value;
        return;
      }
    }
    if (this.varsByName === undefined) {
      this.prepareScopeFrameDeclarationIndex();
    }
    const bucket = this.varsByName?.get(key);
    if (!bucket || bucket.length === 0) {
      return;
    }
    let entry = bucket[bucket.length - 1]!;
    for (let i = bucket.length - 1; i >= 0; i--) {
      if (bucket[i]!.sourceNode === declaration) {
        entry = bucket[i]!;
        break;
      }
    }
    entry.cell.value = value;
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
      if (hasCarriedMergeOutputSurface(node)) {
        this.hasMergeOutputSurface = true;
      }
      this.registerNode(node);
    }
  }

  at(index: number) {
    let target = index;
    if (target < 0) {
      let indexedCount = 0;
      for (let i = 0; i < this.rules.length; i++) {
        if (!isNode(this.rules[i]!, N.Comment)) {
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
      if (isNode(node, N.Comment)) {
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
      if (isThenable<this>(mp)) {
        return mp
          .then((result: this) => {
            popNestableBody();
            return result;
          })
          .catch((error: unknown) => {
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
    const parentAtRule = isNode(this.parent, N.AtRule) ? this.parent : undefined;
    return parentAtRule ? NESTABLE_AT_RULE_NAMES.has(String(parentAtRule.name.valueOf())) : false;
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
    if (isThenable<RegistrationPrepState>(pendingResult)) {
      return pendingResult.then((scanState: RegistrationPrepState) =>
        this._finishRegistrationPrep(rules, context, saved, scanState)
      );
    }
    return this._finishRegistrationPrep(rules, context, saved, pendingResult);
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
      const nodeIndex = !isNode(node, N.Comment) ? indexedRuleCount++ : undefined;
      if (isNode(node, N.Any) && node.role === 'charset') {
        // Charset is root output-order bookkeeping, not name registration.
        if (!context.currentCharset) {
          context.currentCharset = node;
        }
        node.registrationPrepared = true;
        const placeholder = new Nil(
          '',
          undefined,
          sourceSpanOf(node)
        );
        placeholder.sourceNode = node;
        placeholder.index = nodeIndex;
        rules.rules[index] = placeholder;
        return;
      }
      if (isImportAtRule(node)) {
        // CSS @import hoisting is output-order bookkeeping, not name registration.
        // Preserve the prelude as authored; evaluating here can strip comment tokens.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        queueTopImport(context, node as unknown as AtRuleStatement);
        node.registrationPrepared = true;
        const placeholder = new Nil(
          '',
          undefined,
          sourceSpanOf(node)
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
    if (isThenable<void>(declarationResult)) {
      return declarationResult.then(finishAfterDeclarations);
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
      (isNode(node, N.Declaration) || isNode(node, N.VarDeclaration))
      && !node.options?.assign
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
   * Does a name/path value resolve to a fixed identifier at construction time?
   * A primitive (bare string) always does; a name/path Node answers from its own
   * structure (`hasStaticName`) rather than the bubbled `F_STATIC` flag.
   */
  private _isStatic(value: unknown): boolean {
    if (hasStaticNameMethod(value)) {
      return value.hasStaticName();
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
      if ((isNode(node, N.Declaration) || isNode(node, N.VarDeclaration)) && !isBindingReassignment(node)) {
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
    const sourceRules = sourceRulesOf(rules);
    const reusesSourceChild = sourceRules !== rules && node.parent === sourceRules;
    const replacedMergeSurface = hasCarriedMergeOutputSurface(rules.rules[index]!);
    rules.rules[index] = node;
    if (hasCarriedMergeOutputSurface(node)) {
      rules.hasMergeOutputSurface = true;
    } else if (replacedMergeSurface) {
      rules.refreshMergeOutputSurface();
    }
    node.index = nodeIndex;
    if (!reusesSourceChild) {
      rules.adopt(node);
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
      // Other selector types (Interpolated/Ampersand/Attribute/Pseudo): ask the
      // selector whether its identity is fixed at construction, from structure.
      if (hasStaticNameMethod(selector)) {
        return selector.hasStaticName();
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
    if (isThenable<void>(result)) {
      return result.then(finish);
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
    if (isThenable<void>(orderedResult)) {
      return orderedResult.then(finish);
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
        const replacedMergeSurface = hasCarriedMergeOutputSurface(node);
        rules.rules[i] = resolvedNode;
        if (hasCarriedMergeOutputSurface(resolvedNode)) {
          rules.hasMergeOutputSurface = true;
        } else if (replacedMergeSurface) {
          rules.refreshMergeOutputSurface();
        }
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

          if (isThenable<Node>(result)) {
            const remaining: Node[] = [];
            for (let nextIndex = i + 1; nextIndex < unresolvedDeclarations.length; nextIndex++) {
              remaining.push(unresolvedDeclarations[nextIndex]!);
            }
            return result.then((resolvedNode: Node) => {
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

          if (handleResolvedNode(result, node, stillUnresolved)) {
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

          if (isThenable<Node>(result)) {
            const remaining: Node[] = [];
            for (let nextIndex = i + 1; nextIndex < orderedIdentities.length; nextIndex++) {
              remaining.push(orderedIdentities[nextIndex]!);
            }
            return result.then((resolvedNode: Node) => {
              handleResolvedNode(resolvedNode, node, []);
              // Continue with remaining nodes
              orderedIdentities.length = 0;
              for (let nextIndex = 0; nextIndex < remaining.length; nextIndex++) {
                orderedIdentities.push(remaining[nextIndex]!);
              }
              return resolveOrderedOnce();
            });
          }

          handleResolvedNode(result, node, []);
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
    // and we don't want to lose leakyScope and other settings
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

  private _evaluateSourceOrder(
    rules: Rules,
    context: Context,
    importsOnly = false
  ): MaybePromise<{ output: Rules; rulesToHoist: boolean }> {
    let rulesToHoist = false;
    const pendingImports: Array<[number, Node]> = [];
    // §2.7: never mutate the canonical node. Source children are read from
    // `rules`; evaluated results are written to `output`, which stays `rules`
    // until the FIRST child whose result differs — then a fresh derive surface
    // (shared children array copied, sourceNode -> canonical) takes the writes.
    let output = rules;
    // A node carrying a `sourceNode` that points elsewhere is already a per-eval
    // surface (e.g. the registration-prepared root) — its array slots are not
    // shared canonical state, so writing them in place is safe and needs no
    // second derive. Only a CANONICAL node (no foreign sourceNode) must be
    // copied-on-write before any child result is written into it.
    const rulesIsCanonical = rules.sourceNode === undefined || rules.sourceNode === rules;
    const writableOutput = (): Rules => {
      if (output === rules && rulesIsCanonical) {
        output = rules.derive() as Rules;
        // The output resolves scope identically to the canonical (share its
        // prepared scope frame), and becomes the current rules context so later
        // siblings + registration during this same eval stay consistent. Build the
        // source frame first if it isn't cached yet: registerNode links an inlining
        // import's fallback frame onto `_scopeFrame` at splice time, and later
        // siblings (e.g. a consumer referencing an imported property) resolve through
        // the SAME source frame via the node parent chain. Without a shared frame the
        // output would lazily build its own, and the inline-import fallback link would
        // never reach the consumer's lookup.
        const sharedFrame = rules.getScopeFrame();
        output.scopeFrame = sharedFrame;
        // Re-point the shared frame's node back-pointer to the output. The
        // child-surface crawl (collectDirectChildRulesEntries / findMixin's
        // namespace descent) reads `frame.rulesNode.rules` to reach evaluated
        // callable children — mixin-call OUTPUT rulesets spliced into `output`
        // during this eval. The canonical `rules.rules` never gains those output
        // children (invariant: canonical is immutable), so a frame still pointing
        // at the canonical makes an evaluated namespace member (`.person` produced
        // by a mixin call, incl. post-interpolation names) invisible to a later
        // sibling `.person.sayGender` lookup. The frame IS this scope's identity;
        // after COW-derive the output supersedes the canonical for the rest of the
        // eval (context.rulesContext/root follow it below), so its lookup surface
        // must be the output's rules. No new frame, no clone.
        sharedFrame.rulesNode = output;
        if (context.rulesContext === rules) {
          context.rulesContext = output;
        }
        // The derive creates a NEW root identity. Anything keyed on root identity
        // (`isOutermost` -> processExtends, extend-root stack) must follow the
        // output, exactly like rulesContext — otherwise the root's post-eval
        // passes silently skip because `rules === context.root` no longer holds.
        if (context.root === rules) {
          context.root = output;
        }
      }
      return output;
    };

    const applyResult = (idx: number, rule: Node, result: Node | undefined): void => {
      if (result === undefined) {
        return;
      }
      if (result !== rule) {
        const out = writableOutput();
        const replacedMergeSurface = hasCarriedMergeOutputSurface(out.rules[idx]!);
        out.rules[idx] = result;
        if (hasCarriedMergeOutputSurface(result)) {
          out.hasMergeOutputSurface = true;
        } else if (replacedMergeSurface) {
          out.refreshMergeOutputSurface();
        }
        if (isNode(result, N.Rules)) {
          result.index = idx;
          out.adopt(result);
          out.registerNode(result, {
            rulesVisibility: result.options.rulesVisibility,
            readonly: result.options.readonly
          }, context);
          if (context.options.leakyScope && isNode(rule, N.Call) && result.options.mixinOutputSlot) {
            out.injectLeakyMixinOutputBindings(result, idx);
          }
          if (result.hoistToRoot) {
            rulesToHoist = true;
          }
          return;
        }
        out.adopt(result);
      }
      if (result.hoistToRoot) {
        rulesToHoist = true;
      }
    };

    const evaluateEntry = (idx: number, rule: Node, allowImportRetry: boolean): MaybePromise<void> => {
      if (isNode(rule, N.VarDeclaration)) {
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
      const result = (() => {
        try {
          const value = rule.eval(context);
          return isThenable<Node>(value)
            ? value.catch(handleError)
            : value;
        } catch (error) {
          return handleError(error);
        }
      })();
      if (isThenable<Node | undefined>(result)) {
        return result.then((resolved: Node | undefined) => applyResult(idx, rule, resolved));
      }
      applyResult(idx, rule, result);
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
      if (isThenable<void>(drained) && allowRetry) {
        return drained.then(() => drainPendingImports(false));
      }
      return drained;
    };

    // A reference-import-only pass (namespace-mixin body eval, §Mixin.evalNode)
    // resolves ONLY the reference/dedupe StyleImport children into callable
    // surfaces — it must not run the call/normal body lanes (that is a full
    // body eval, reserved for a real call). Plain (non-reference) imports also
    // stay cold: they contribute render output, not callable descendants.
    const isReferenceImportNode = (rule: Node): boolean => {
      if (!isStyleImportRegistrationNode(rule)) {
        return false;
      }
      const importOptions = 'importOptions' in rule.options ? rule.options.importOptions : undefined;
      return importOptions?.reference === true || importOptions?._dedupe === true;
    };
    const evaluateImports = evaluateLane(
      importsOnly ? isReferenceImportNode : isStyleImportRegistrationNode,
      true
    );
    const evaluateBody = (): MaybePromise<{ output: Rules; rulesToHoist: boolean }> => {
      const importDrain = drainPendingImports(false);
      const afterImports = () => {
        if (importsOnly) {
          return { output, rulesToHoist };
        }
        const calls = evaluateLane(rule => isNode(rule, N.Call), false);
        const afterCalls = () => {
          const normal = evaluateLane((rule) => {
            if (isNode(rule, N.VarDeclaration) || isStyleImportRegistrationNode(rule) || isNode(rule, N.Call)) {
              return false;
            }
            return true;
          }, false);
          if (isThenable<void>(normal)) {
            return normal.then(() => ({ output, rulesToHoist }));
          }
          return { output, rulesToHoist };
        };
        if (isThenable<void>(calls)) {
          return calls.then(afterCalls);
        }
        return afterCalls();
      };
      if (isThenable<void>(importDrain)) {
        return importDrain.then(afterImports);
      }
      return afterImports();
    };

    if (isThenable<void>(evaluateImports)) {
      return evaluateImports.then(evaluateBody);
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
      const v = decl.value;
      return v instanceof Node ? v : undefined;
    };
    const replaceOwnedDeclaration = (
      ownerRules: Rules,
      source: Declaration,
      replacement: Declaration
    ): Declaration => {
      const index = ownerRules.rules.indexOf(source);
      if (index !== -1) {
        ownerRules.rules[index] = replacement;
      }
      ownerRules.adopt(replacement);
      return replacement;
    };
    const replaceDeclarationValue = (decl: Declaration, value: Node): Declaration => {
      const replacement = decl.deriveWithParts({ value });
      return isNode(decl.parent, N.Rules)
        ? replaceOwnedDeclaration(decl.parent, decl, replacement)
        : replacement;
    };
    const copyMergedValue = (value: Node): Node => (
      value.canReuseAsLeaf()
        ? value.reuseAsLeaf()
        : value.cloneForPlacement()
    );
    const forEachMergedItem = (
      value: Node,
      assign: string,
      visit: (node: Node) => boolean | void
    ): boolean => {
      const stack: Node[] = [value];
      let keepGoing = true;
      while (stack.length > 0 && keepGoing) {
        const node = stack.pop()!;
        if (isNode(node, N.List)) {
          for (let i = node.value.length - 1; i >= 0; i--) {
            stack.push(node.value[i]!);
          }
          continue;
        }
        if (assign === '&_:' && isNode(node, N.Sequence)) {
          for (let i = node.value.length - 1; i >= 0; i--) {
            stack.push(node.value[i]!);
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
      const priorItems = collectMergedItems(priorValue, assign);
      const nextItems = collectMergedItems(nextValue, assign);
      // Drop the leading run of `next` that already appears as the tail of `prior`:
      // the eval-time merge Reference re-emits the immediately-prior sibling's own
      // contribution, so a naive concat would duplicate it. Find the longest prefix
      // of `next` that equals a suffix of `prior`. Applies to comma (`&,:`) and
      // space (`&_:`) merges alike.
      let nextStart = 0;
      const maxOverlap = Math.min(priorItems.length, nextItems.length);
      for (let overlap = maxOverlap; overlap > 0; overlap--) {
        let matches = true;
        for (let i = 0; i < overlap; i++) {
          if (!sameMergedItem(priorItems[priorItems.length - overlap + i]!, nextItems[i]!)) {
            matches = false;
            break;
          }
        }
        if (matches) {
          nextStart = overlap;
          break;
        }
      }
      const mergedItems = new Array<Node>(priorItems.length + nextItems.length - nextStart);
      let mergedIndex = 0;
      for (let i = 0; i < priorItems.length; i++) {
        mergedItems[mergedIndex++] = copyMergedValue(priorItems[i]!);
      }
      for (let i = nextStart; i < nextItems.length; i++) {
        mergedItems[mergedIndex++] = copyMergedValue(nextItems[i]!);
      }
      return assign === '&_:' ? spaced(mergedItems) : new List(mergedItems);
    };
    const inlineCrossScopeMergedLeadingReference = (
      decl: Node,
      priorValue: Node,
      assign: string
    ): Node => {
      if (!isNode(decl, N.Declaration)) {
        return decl;
      }
      const currentValue = getDeclValue(decl);
      const container = assign === '&_:'
        ? (isNode(currentValue, N.Sequence) ? currentValue : undefined)
        : (isNode(currentValue, N.List) ? currentValue : undefined);
      if (!container || container.value.length === 0) {
        return decl;
      }
      const first = container.value[0];
      if (!isNode(first, N.Reference) || first.options?.type !== 'declaration') {
        return decl;
      }
      const inlinedItems = new Array<Node>(container.value.length);
      inlinedItems[0] = copyMergedValue(priorValue);
      for (let i = 1; i < container.value.length; i++) {
        inlinedItems[i] = copyMergedValue(container.value[i]!);
      }
      const inlinedValue = assign === '&_:'
        ? spaced(inlinedItems)
        : new List(inlinedItems);
      return replaceDeclarationValue(decl, inlinedValue);
    };
    const composeMergedValue = (
      decl: Node,
      ownerRules: Rules,
      prior: Node,
      assign: string,
      priorAccumulatedValue?: Node
    ): { value: Node; node: Node } | undefined => {
      if (!isNode(decl, N.Declaration) || !isNode(prior, N.Declaration)) {
        return undefined;
      }
      const nextDeclValue = getDeclValue(decl);
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
      const mergedValue = mergeDeclarationValues(basePriorValue, nextDeclValue, assign);
      let outputDecl = replaceDeclarationValue(decl, mergedValue);
      outputDecl = normalizeMergedDeclarationValue(outputDecl);
      const declImportant = decl.important;
      const priorImportant = prior.important;
      if (!declImportant && priorImportant) {
        outputDecl = replaceOwnedDeclaration(
          ownerRules,
          outputDecl,
          outputDecl.deriveWithParts({
            value: outputDecl.value,
            important: priorImportant
          })
        );
      }
      const mergedDeclValue = getDeclValue(outputDecl);
      return mergedDeclValue ? { value: mergedDeclValue, node: outputDecl } : undefined;
    };
    const normalizeMergedDeclarationValue = (node: Node): Declaration => {
      if (!isNode(node, N.Declaration)) {
        throw new TypeError('Expected declaration while normalizing merged declaration value');
      }
      const declValue = getDeclValue(node);
      if (!declValue) {
        return node;
      }
      const current = declValue;
      if (!isNode(current, N.List) || current.value.length === 0) {
        return node;
      }
      const first = current.value[0];
      const isEmptyPlaceholder = Boolean(
        first
        && (
          isNode(first, N.Nil)
          || (isNode(first, N.List) && first.value.length === 0)
          || (isNode(first, N.Any) && first.value === '')
        )
      );
      if (!isEmptyPlaceholder) {
        return node;
      }
      if (current.value.length === 1) {
        return replaceDeclarationValue(node, new Nil());
      }
      if (current.value.length === 2) {
        return replaceDeclarationValue(node, copyMergedValue(current.value[1]!));
      }
      const rest = new Array<Node>(current.value.length - 1);
      for (let i = 1; i < current.value.length; i++) {
        rest[i - 1] = copyMergedValue(current.value[i]!);
      }
      return replaceDeclarationValue(node, new List(rest));
    };

    const lastVisibleByName = new Map<string, DeclOccurrence>();
    const mergedAnchorByName = new Map<string, DeclOccurrence>();
    const accumulatedValueByName = new Map<string, Node>();
    const processDeclarationOccurrence = (node: Node, ownerRules: Rules, inMixinOutput: boolean): void => {
      if (!isNode(node, N.Declaration)) {
        return;
      }
      let currentNode: Node = node;
      const name = String(node.name);
      const assign = String(node.options.normalizedFromAssign ?? '');
      const merged = isMergedAssign(assign);

      if (!merged) {
        mergedAnchorByName.delete(name);
        accumulatedValueByName.delete(name);
        if (node.visible) {
          lastVisibleByName.set(name, { node, ownerRules });
        }
        return;
      }
      // A mixin-ruleset output reuses the callee's evaluated declaration node by
      // identity (thin model): the SAME node is both the callee's own rendered
      // declaration and the placement copy in this host's output subtree. A merge
      // occurrence here can be superseded by a later `+:` in the host, and the
      // coalesce marks it merge-suppressed by node identity — which would also hide
      // the callee's own declaration. Detach (COW) the shared placement copy into a
      // distinct instance owned by the output surface before it can be superseded.
      if (inMixinOutput) {
        const idx = ownerRules.rules.indexOf(node);
        if (idx !== -1) {
          const copy = node.deriveWithParts({ value: node.value });
          ownerRules.rules[idx] = copy;
          ownerRules.adopt(copy);
          node = copy;
        }
      }
      currentNode = normalizeMergedDeclarationValue(node);
      let currentAccumulatedValue: Node | undefined;

      const prior = lastVisibleByName.get(name);
      const priorAccumulatedValue = accumulatedValueByName.get(name);
      const needsCrossScopeCompose = prior
        && prior.ownerRules !== ownerRules;
      // The eval-time merge Reference reads the PRIOR sibling's own value; across
      // a mixin-output boundary it truncates to the callee's contribution, so the
      // current occurrence's value can drop earlier chain items (e.g. a mixin's
      // `transform+:` contribution vanishing behind the host's own `transform+:`).
      // The coalesce pass owns the cross-scope combine: compose whenever an earlier
      // merged anchor accumulated a value that the current value does not already
      // carry as a prefix — regardless of the mixin-output boundary. `composeMergedValue`
      // is a no-op (returns the value unchanged) when the prefix already matches, so
      // this stays byte-identical on the common in-scope path.
      const currentValueForPrefix = getDeclValue(currentNode);
      const shouldComposeAcrossScopes = Boolean(
        prior
        && priorAccumulatedValue
        && (
          needsCrossScopeCompose
          || !(
            currentValueForPrefix
            && startsWithMergedValue(currentValueForPrefix, priorAccumulatedValue, assign)
          )
        )
      );
      if (priorAccumulatedValue && shouldComposeAcrossScopes) {
        currentNode = inlineCrossScopeMergedLeadingReference(currentNode, priorAccumulatedValue, assign);
      }
      if (prior && shouldComposeAcrossScopes) {
        const composed = composeMergedValue(
          currentNode,
          ownerRules,
          prior.node,
          assign,
          priorAccumulatedValue
        );
        currentAccumulatedValue = composed?.value ?? currentAccumulatedValue;
        currentNode = composed?.node ?? currentNode;
      }
      const currentValue = getDeclValue(currentNode);
      currentAccumulatedValue ??= currentValue;

      const existingAnchor = mergedAnchorByName.get(name);
      const occurrence = { node: currentNode, ownerRules };
      if (existingAnchor && isNode(existingAnchor.node, N.Declaration)) {
        const anchorIsSameOccurrence = existingAnchor.node === currentNode
          && existingAnchor.ownerRules === ownerRules;
        if (!anchorIsSameOccurrence) {
          if (existingAnchor.node === currentNode && existingAnchor.ownerRules !== ownerRules) {
            existingAnchor.ownerRules.addFlag(F_MERGE_SUPPRESSED);
          } else {
            existingAnchor.node.addFlag(F_MERGE_SUPPRESSED);
          }
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
    const walkMergedDeclarations = (node: Node, ownerRules: Rules, inMixinOutput: boolean): void => {
      if (isNode(node, N.Declaration)) {
        processDeclarationOccurrence(node, ownerRules, inMixinOutput);
        return;
      }
      // A nested Ruleset / at-rule is its OWN cascade scope (a distinct selector
      // block, coalesced by its own eval pass). `Ruleset`'s nodeType carries the
      // `Rules` bit, so guard against it explicitly — otherwise sibling rulesets
      // are walked as one merge chain and later `+:` values suppress earlier
      // selectors. Only descend into inline Rules (mixin outputs, plain groups)
      // that render into the CURRENT selector scope.
      if (!isNode(node, N.Rules) || isNode(node, N.Ruleset | N.AtRule)) {
        return;
      }
      const childInMixinOutput = inMixinOutput || Boolean(node.options.mixinOutputSlot);
      for (let i = 0; i < node.rules.length; i++) {
        walkMergedDeclarations(node.rules[i]!, node, childInMixinOutput);
      }
    };

    for (const node of rules.rules) {
      walkMergedDeclarations(node, rules, Boolean(rules.options.mixinOutputSlot));
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

  private _finishSourceOrderEvaluation(rules: Rules, rulesToHoist: boolean): { rules: Rules; rulesToHoist: boolean } {
    this._normalizeCallDeclarationRulesOrder(rules);
    if (hasMergeOutputSurface(rules)) {
      recordMergeProfile?.('admittedCalls');
      this._coalesceMergedDeclarations(rules);
      recordMergeProfile?.('calls');
    }
    return {
      rules,
      rulesToHoist
    };
  }

  /**
   * After registration prep: ensure root on extend stack, then evaluate
   * children in source order.
   */
  private _evalAfterRegistrationPrep(
    rules: Rules,
    context: Context,
    importsOnly = false
  ): MaybePromise<{ rules: Rules; rulesToHoist: boolean }> {
    this._ensureRootExtendStack(rules, context);
    this._assignRootDocumentOrder(rules, context);
    const evaluated = this._evaluateSourceOrder(rules, context, importsOnly);
    if (isThenable<{ output: Rules; rulesToHoist: boolean }>(evaluated)) {
      return evaluated.then(({ output, rulesToHoist }: { output: Rules; rulesToHoist: boolean }) =>
        this._finishSourceOrderEvaluation(output, rulesToHoist)
      );
    }
    const { output, rulesToHoist } = evaluated;
    return this._finishSourceOrderEvaluation(output, rulesToHoist);
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
            && !isBindingReassignment(currentDecl)
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
    // The document-order map is read only during extend application
    // (documentOrderOf in extend.ts). With no extends anywhere in the tree
    // (root._hasExtends aggregates nested + mixin-body extends via
    // rulesMayContainExtends), the map is never consulted — skip the whole walk.
    if (!rules._hasExtends) {
      return;
    }
    const map = new WeakMap<Ruleset, number>();
    context.documentOrderByRuleset = map;
    this._assignDocumentOrderDepthFirst(rules, map, { value: 0 });
  }

  private _prepareForEval(
    context: Context,
    importsOnly = false
  ): MaybePromise<{ rules: Rules; rulesToHoist: boolean }> {
    // The DYNAMIC enclosing scope, captured before we overwrite rulesContext.
    // A derived eval surface's lexical parent is where it is being PLACED, not
    // its static canonical parent — see _evalPreparedRules.
    const enclosingScope = isNode(context.rulesContext, N.Rules)
      ? context.rulesContext
      : undefined;
    this._setupContextForRules(context, this);
    const rulesAfterPrep = this._prepareRegistrationForEval(context);
    if (isThenable<Rules>(rulesAfterPrep)) {
      return rulesAfterPrep.then((rules: Rules) =>
        this._evalPreparedRules(rules, context, enclosingScope, importsOnly)
      );
    }
    return this._evalPreparedRules(rulesAfterPrep, context, enclosingScope, importsOnly);
  }

  private _evalPreparedRules(
    rules: Rules,
    context: Context,
    enclosingScope?: Rules,
    importsOnly = false
  ): MaybePromise<{ rules: Rules; rulesToHoist: boolean }> {
    // Fix the parent WALK, don't clone around it. `getScopeFrame` bakes the
    // static canonical `this.parent` as a frame's lexical parent. But a shared
    // canonical child placed in a surface (style import / mixin body / loop)
    // must resolve free vars up the DYNAMIC placement chain — where it is being
    // evaluated — not its canonical parent. Re-point the frame's lexical parent
    // to the enclosing eval scope. This is the frame-based replacement for the
    // old `adopt` reparenting; no node is reparented and no sub-tree is cloned.
    //
    // Only for `rules === this` (a canonically-evaluated node): for a canonical
    // non-placement node the enclosing scope already equals the static parent,
    // so this is a no-op; for a placed shared child it is the fix. A DERIVED
    // surface (`rules !== this`, e.g. a mixin output) keeps its own wired parent
    // (its lexical definition scope), which must not be overwritten by the call
    // site. See LIVE_BINDING_ARCHITECTURE.md §4.
    if (
      rules === this
      && rules !== enclosingScope
      // A THIN SURFACE is intrinsically a Rules whose `sourceNode` points at a
      // DIFFERENT canonical body — it re-uses that shared canonical body over a
      // per-placement scope frame (a mixin/ruleset body call, a style import). A
      // canonical node instead points at itself / nothing. The canonical body can
      // be any Rules SUBCLASS: a plain Rules (detached/import), a Mixin (mixin
      // body — since the Mixin.sourceNode wrapper was eliminated the per-call
      // surface's sourceNode IS the Mixin), or a Ruleset. `instanceof Rules`
      // covers all three; a bitmask `N.Rules` check misses Mixin/Ruleset (distinct
      // nodeType bits) and would silently stop re-pointing mixin-body surfaces.
      && enclosingScope?.sourceNode instanceof Rules
      && enclosingScope.sourceNode !== enclosingScope
      // EXCEPT a callable adopted under a RETAINED mixin-output namespace member:
      // `.person.sayGender()` binds `.sayGender`'s per-call surface under the output
      // `.person`, whose frame chains to the call's retained param slot
      // (`gender_="Male"`, hasLiveBindings). That definition parent — not the call
      // SITE (enclosingScope) — is where `.sayGender`'s body resolves `@gender`. The
      // placement re-point would clobber it with the caller, where `@gender` is
      // undefined. Same retained-frame signal c1ded0b6c uses for value resolution
      // (ownerFrame.parent.hasLiveBindings); here it gates the lexical-parent choice.
      && !isRetainedOutputDefinitionParent(rules.parent, enclosingScope)
    ) {
      // A child evaluated under a thin surface resolves its free vars up the
      // PLACEMENT scope, not its static canonical parent. Re-point its
      // scope-frame lexical parent to the surface — whose frame holds the
      // placement's lexical parent + per-placement live slots (params, import
      // with/set). One behavior for every node-re-use site, keyed on what the
      // node IS (its sourceNode), not a stamped marker. No reparent, no clone.
      // See LIVE_BINDING_ARCHITECTURE.md §4 / §6.2.
      const placementFrame = enclosingScope.getScopeFrame();
      rules.getScopeFrame().parent = placementFrame;
      // Signal Ruleset.finishEvaluatedRules NOT to bake this eval's output back into
      // the shared canonical node — but ONLY when the placement scope resolves live
      // per-call bindings (mixin params). Such a body produces DIFFERENT output per
      // call (the mixins-nested second-call bug: `width: @a` baked to `30`), so it
      // must return a fresh surface. A placement with no live-binding ancestor
      // (a nested ruleset / @media body re-used for selector nesting) produces the
      // same output every eval, so the in-place bake stays correct there — and, more
      // importantly, keeps the node identity that extend post-processing relies on.
      if (frameChainHasLiveBindings(placementFrame)) {
        rules._placementRepointed = true;
      }
    } else if (rules === this && rules._closureScope) {
      // Detached-ruleset closure: a Rules passed as an arg / stored in a variable
      // closes over the SURFACE where it was written (`_closureScope`, captured at
      // arg-binding), which carries the enclosing per-call param slots — NOT its
      // canonical `.parent`. When such a body is evaluated (eagerly at arg-bind or
      // lazily on call), re-point its scope-frame lexical parent to that closure
      // surface so free vars resolve up the placement scope. The enclosingScope
      // (§4) branch above handles shared canonical bodies under a thin surface; a
      // detached ruleset's placement is instead pinned by its captured closure.
      rules.getScopeFrame().parent = rules._closureScope.getScopeFrame();
    }
    this._setupContextForRules(context, rules);
    // When we're the outermost Rules, use the tree we're evaling as root
    // (may differ from context.root set in getTree, or be a prepared wrapper).
    // EXCEPT under the spine fold: there is no `Rules.eval` frame for the real
    // root on `rulesEvalStack`, so a detached-ruleset/mixin body evaluated inside
    // the fold hits `length === 1` and would reclaim outermost status — clobbering
    // the spine-owned root and its built-in function registry (see
    // `Context.spineOwnsRoot`). The spine already established the root, so skip.
    if (context.rulesEvalStack.length === 1 && !context.spineOwnsRoot) {
      context.root = rules;
    }
    return this._evalAfterRegistrationPrep(rules, context, importsOnly);
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
    return this._prepareRegistrationOnce(context);
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
    // The evaluated OUTPUT (which render/serialize hold) may be a derived node,
    // not `this`; carry the eval-state signal onto it so `evaluated` is true for
    // the tree callers actually render.
    rules._bodyEvaluated = true;
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
    // Narrow §2.7 eval-state signal: this Rules body has now been evaluated.
    // Marked on the canonical node (`this`) — what callable-descendant lookup
    // reads via `entry` — so a never-evaluated body stays cold. Mixin.evalNode
    // returns self without reaching here, so it stamps this flag itself.
    this._bodyEvaluated = true;
    const saved = this._snapshotContext(context);
    context.rulesEvalStack.push(sourceRulesOf(this));
    let result: MaybePromise<{ rules: Rules; rulesToHoist: boolean }>;
    try {
      result = this._prepareForEval(context);
    } catch (error) {
      this._restoreEvalAfterError(context, saved);
      throw error;
    }
    const finish = ({ rules }: { rules: Rules; rulesToHoist: boolean }): Rules => this._finishEval(rules, context, saved);
    if (isThenable(result)) {
      return result.then(
        finish,
        (error) => {
          this._restoreEvalAfterError(context, saved);
          throw error;
        }
      );
    }
    return finish(result);
  }

  /**
   * Evaluate ONLY this body's reference/dedupe StyleImport children into
   * callable surfaces, preparing body registration first. Used by a namespace
   * mixin body (`Mixin.evalNode`), whose lazy self-return never walks the body:
   * a `reference:true` import inside it would otherwise stay unevaluated, so its
   * imported mixins never become reachable callable descendants. This runs the
   * shared eval pipeline's import lane only — no call/normal body lanes — so the
   * body is not fully evaluated (that is reserved for a real call). No-op when
   * the body carries no reference imports.
   */
  resolveBodyReferenceImports(context: Context): MaybePromise<Rules> {
    if (!rulesMayContainReferenceImports(this)) {
      return this;
    }
    const saved = this._snapshotContext(context);
    context.rulesEvalStack.push(sourceRulesOf(this));
    let result: MaybePromise<{ rules: Rules; rulesToHoist: boolean }>;
    try {
      result = this._prepareForEval(context, true);
    } catch (error) {
      this._restoreEvalAfterError(context, saved);
      throw error;
    }
    const finish = ({ rules }: { rules: Rules; rulesToHoist: boolean }): Rules =>
      this._finishEval(rules, context, saved);
    if (isThenable(result)) {
      return result.then(
        finish,
        (error) => {
          this._restoreEvalAfterError(context, saved);
          throw error;
        }
      );
    }
    return finish(result);
  }

  override resolve(context: Context): MaybePromise<Node> {
    if (this.hasFlag(F_STATIC)) {
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

/**
 * Ruleset-only, whole-selector lookup shared by Jess `$apply` and `*[…]` selector
 * capture. Resolves `selector` (e.g. `.foo`) against `scope`'s callable surface,
 * returning EVERY matching plain `Ruleset` (`.foo {}`) — merge-all, in scope order.
 * Parametric `Mixin` definitions (`.foo() {}` / `.foo(@a) {}`) are NEVER returned;
 * this deliberately does not touch the args/guards callable machinery.
 *
 * A capture whose selector has no plain basic key (e.g. `*`, `:hover`) yields `[]`.
 */
export function resolveRulesetBySelector(
  selector: Selector | string | undefined,
  scope: Rules
): Ruleset[] {
  const keys = getOrderedSelectorKeys(selector);
  if (keys.length === 0) {
    return [];
  }
  const found: Ruleset[] = [];
  const seen = new Set<Ruleset>();
  for (const key of keys) {
    for (const entry of scope.findMixinsFast(key, { rulesetsOnly: true })) {
      // rulesetsOnly guarantees Rulesets, but narrow defensively + de-dupe.
      if (isNode(entry, N.Ruleset) && !seen.has(entry)) {
        seen.add(entry);
        found.push(entry);
      }
    }
  }
  return found;
}

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
function mixinHasNoRequiredParams(mixinNode: Mixin): boolean {
  const params = mixinNode.params;
  if (!params || params.length === 0) {
    return true;
  }
  for (const param of params.value) {
    if (param.type === 'Rest') {
      continue;
    }
    if (isNode(param, N.VarDeclaration)) {
      if (param.value instanceof Nil) {
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
