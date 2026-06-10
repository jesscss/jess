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
import { type Ruleset } from './ruleset.js';
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

import * as Registries from './util/registry-utils.js';
import { processExtends } from './util/extend-roots.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { Nil } from './nil.js';
import { VarDeclaration } from './declaration-var.js';
import { List } from './list.js';
import {
  indent,
  normalizeBlockTrivia,
  normalizeIndent,
  serializeRulesContainerInline,
  hasPrintableTriviaAt
} from './util/serialize-helper.js';
import { canReuseLeaf, copyWithReusableLeaves, reuseLeaf } from './util/cloning.js';
import type { AtRule } from './at-rule.js';
import {
  assignScopeFrameVariable,
  buildScopeFrame,
  lookupScopeFrameCallable,
  type ScopeFrame
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
  canEnterRulesEntryForLookup
} from './util/mixin-output-slot.js';
import type { MixinOutputSlot } from './util/mixin-output-slot.js';
import { canRenderStaticRulesDirectly } from './util/static-rules.js';
import type { CallableLookupEntry, MixinEntry } from './util/callable-entry.js';
import { isIndexedRuleChild } from './util/callable-surface.js';
import { queueTopImport } from './util/import-queue.js';
import {
  DIRECT_DECLARATION_LOOKUP_UNCOVERED,
  findDeclarationDirect
} from './util/direct-rules-lookup.js';
const { isArray } = Array;
const NESTABLE_AT_RULE_NAMES = new Set(['@media', '@supports', '@layer', '@container', '@scope']);
const MAX_DECLARATION_NAME_REGISTRATION_RETRIES = 5;
const REGISTRYLESS_MIXIN_CACHE_KEY_SEPARATOR = '\u001e';
const REGISTRYLESS_MIXIN_PATH_KEY_SEPARATOR = '\u001f';
type StyleImportRegistrationNode = Node<{ path: unknown }>;
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

function isStyleImportRegistrationNode(node: Node): node is StyleImportRegistrationNode {
  return node.type === 'StyleImport';
}

function isImportAtRule(node: Node): node is AtRule {
  return isNode(node, N.AtRule)
    && String(node.value.name.valueOf?.() ?? node.value.name ?? '').trim() === '@import';
}

function keysStartWith(keys: readonly string[], path: readonly string[]): boolean {
  if (keys.length > path.length) {
    return false;
  }
  for (let i = 0; i < keys.length; i++) {
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
  const matches = key.match(/[#.][^#.]+/g);
  return matches && matches.length > 1 ? matches : undefined;
}

function getCallableRulesetKeyPaths(ruleset: Ruleset): string[][] {
  const selector = ruleset.value.selector;
  if (isNode(selector, N.Nil)) {
    return [];
  }
  if (isNode(selector, N.SelectorList)) {
    const out: string[][] = [];
    for (let i = 0; i < selector.value.length; i++) {
      const keys = Registries.getOrderedSelectorKeys(selector.value[i]!);
      if (keys.length > 0) {
        out.push(keys);
      }
    }
    return out;
  }
  const keys = Registries.getOrderedSelectorKeys(selector);
  return keys.length > 0 ? [keys] : [];
}

function isSelectorLikeNode(node: unknown): node is Selector {
  return isNode(
    node,
    N.Selector
    | N.SelectorList
    | N.ComplexSelector
    | N.CompoundSelector
    | N.BasicSelector
    | N.InterpolatedSelector
    | N.Ampersand
    | N.PseudoSelector
  );
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
    ? node.toString(prepared)
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
  if (directSourceRender && node.type === 'Rules') {
    if (
      (node === context.root || source === context.root)
      && (context.currentCharset || context.topImports?.length)
    ) {
      return node.toString(prepared);
    }
    const rendered = node.toRenderString(prepared);
    const finish = (text: string): string => text === '' || text.endsWith('\n') ? text : `${text}\n`;
    return isThenable(rendered)
      ? rendered.then(finish)
      : finish(rendered);
  }
  if (
    node.type === 'Rules'
    && (node === context.root || source === context.root)
  ) {
    return node.toString(prepared);
  }
  return node.type === 'Rules'
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
  if (isNode(node, N.Rules)) {
    return node;
  }
  if (isNode(node, N.Ruleset) || isNode(node, N.AtRule) || isNode(node, N.Mixin)) {
    return node.value.rules;
  }
  return undefined;
}

function childCallableRulesOf(node: Node): Rules | undefined {
  if (isNode(node, N.Rules)) {
    return node;
  }
  if (isNode(node, N.Ruleset) || isNode(node, N.AtRule)) {
    return node.value.rules;
  }
  return undefined;
}

function rulesMayContainExactCallableSurface(rules: Rules): boolean {
  const value = rules.value;
  for (let i = 0; i < value.length; i++) {
    const node = value[i]!;
    if (isNode(node, N.Mixin | N.Ruleset | N.AtRule | N.Rules)) {
      return true;
    }
  }
  return false;
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

function normalizeDeclarationFilter(filterType: string | undefined): 'VarDeclaration' | 'Declaration' | undefined {
  return filterType === 'VarDeclaration' || filterType === 'Declaration' ? filterType : undefined;
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

function printDetached(options: PrintOptions, fn: (nextOptions: PrintOptions) => string): string {
  const writer = new OutputWriter();
  const out = fn({
    ...options,
    writer
  });
  return writer.toString() || out;
}

export type RulesVisibility = 'public' | 'optional' | 'private';

export interface RuntimeVarBinding {
  kind: 'runtime-var-binding';
  value: Node;
  readonly?: boolean;
  sourceNode?: Node;
  rulesContext?: Rules;
}

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
  override allowRuleRoot = true;
  override allowRoot = true;

  declarationRegistry: Registries.DeclarationRegistry | undefined;
  functionRegistry: Registries.FunctionRegistry | undefined;
  /** Fast map: var name → ordered list of VarDeclarations registered in this scope. */
  varsByName: Map<string, VarDeclaration[]> | undefined;
  /** Per-request cache: callable start-key -> ordered entries with remaining path keys. */
  callableLookupCache: Map<string, CallableLookupEntry[]> | undefined;
  directChildRuleEntries: Array<{ node: Rules; rulesVisibility?: RulesOptions['rulesVisibility'] }> | null | undefined;
  hasDirectChildRuleSurface = false;
  hasExactCallableChildSurface = false;
  directDeclarationsByName: Map<string, Declaration[]> | undefined;
  directDeclarationLookupCache: Map<string, {
    optionalMatch: Declaration | undefined;
    publicMatch: Declaration | undefined;
    readonly: boolean;
  }> | undefined;

  registrylessMixinLookupCache: Map<string, MixinEntry[] | undefined> | undefined;
  registrylessLastMixinLookupKey: string | undefined;
  registrylessLastMixinLookupValue: MixinEntry[] | undefined;
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

  rulesIndexed = 0;
  _indexing = false;
  private _registrationPrepared = false;

  _indexRules() {
    if (this._indexing) {
      return; // Prevent recursive indexing
    }
    this._indexing = true;
    try {
      if (this.rulesIndexed === 0) {
        this._hasExtends = false;
        this._hasReferenceImports = (this.options as { referenceMode?: boolean } | undefined)?.referenceMode === true;
        this.hasDirectChildRuleSurface = false;
        this.hasExactCallableChildSurface = false;
        this.directChildRuleEntries = undefined;
      }
      // Initialize fast maps so the hot-path can distinguish
      // "indexed (nothing found)" from "not yet indexed" (undefined).
      this.varsByName ??= new Map();
      let value = this.value;
      let length = value.length;
      for (let i = this.rulesIndexed; i < length; i++) {
        const node = value[i]!;
        this.registerNode(node);
      }
      this.rulesIndexed = length;
      if (this._scopeFrame) {
        this._scopeFrame.declarationsCovered = true;
        this._scopeFrame.callableBucketsByName = this.callableLookupCache;
        this._scopeFrame.callablesCovered = this.callableLookupCache !== undefined;
        this._scopeFrame.callableMissesCovered = !this.hasDirectLookupChildSurface();
      }
    } finally {
      this._indexing = false;
    }
  }

  /**
   * Rules clones still need to preserve function registry state so visitor/plugin
   * registrations survive the explicit clone sites that remain outside the hot path.
   */
  override clone(copyChildren?: boolean, cloneFn?: (n: Node) => Node): this {
    const newRules = super.clone(copyChildren, cloneFn);
    newRules.resetDerivedState(this);

    return newRules;
  }

  derive(value: Node[] = [...this.value]): Rules {
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
    // Only preserve *function* registry across clones.
    // This supports Less plugin compat, where plugins can inject functions into the registry
    // without creating AST nodes that would be re-registered on clone.
    //
    // Do NOT reuse declaration/mixin registries across clones; those should always
    // be rebuilt from AST nodes via lazy indexing.
    if (source.functionRegistry) {
      this.functionRegistry = source.functionRegistry.cloneForRules(this);
    }

    // IMPORTANT: cloned Rules must re-index their own registries.
    // Otherwise, a clone can inherit `rulesIndexed` from the source Rules (often == value.length),
    // while having an empty/incorrect registry state, causing lookup misses (e.g. @c in detached-rulesets).
    this.rulesIndexed = 0;
    this._indexing = false;
    this._rulesSet = undefined;
    this.varsByName = undefined;
    this.callableLookupCache = undefined;
    this.directChildRuleEntries = undefined;
    this.hasDirectChildRuleSurface = false;
    this.hasExactCallableChildSurface = false;
    this.directDeclarationsByName = undefined;
    this.directDeclarationLookupCache = undefined;
    this.registrylessMixinLookupCache = undefined;
    this.registrylessLastMixinLookupKey = undefined;
    this.registrylessLastMixinLookupValue = undefined;
    this._hasExtends = false;
    this._hasReferenceImports = false;
    // Preserve only runtime live-slot bindings (mixin params / loop vars) across clones.
    // Ordinary declaration-only ScopeFrames should be rebuilt lazily on the clone so they
    // re-wire against the clone's actual parent chain. Reusing an empty frame from the
    // source tree can shadow a live wrapper frame that actually carries live slots.
    if (source._scopeFrame?.liveSlotsByName.size || source._scopeFrame?.fallbackFrame) {
      this.scopeFrame = buildScopeFrame(
        undefined,
        this,
        source._scopeFrame.parent,
        new Map(source._scopeFrame.liveSlotsByName),
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
   * Requires _indexRules() to have run so varsByName is populated.
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

  getScopeFrame(parent?: ScopeFrame): ScopeFrame {
    if (!this._scopeFrame) {
      if (this.varsByName === undefined) {
        this._indexRules();
      }
      let resolvedParent = parent;
      if (resolvedParent === undefined) {
        let cursor = this.parent;
        while (cursor) {
          if (isNode(cursor, N.Rules)) {
            resolvedParent = (cursor as Rules).getScopeFrame();
            break;
          }
          cursor = cursor.parent;
        }
      }
      const pendingDeclarationNames: VarDeclaration[] = [];
      for (let i = 0; i < this.value.length; i++) {
        const node = this.value[i]!;
        if (isNode(node, N.VarDeclaration) && !this._hasStaticName(node)) {
          pendingDeclarationNames.push(node);
        }
      }
      this._scopeFrame = buildScopeFrame(
        this.varsByName,
        this,
        resolvedParent,
        undefined,
        pendingDeclarationNames,
        undefined,
        this.callableLookupCache,
        undefined,
        !this.hasDirectLookupChildSurface()
      );
    }
    return this._scopeFrame;
  }

  private hasDirectLookupChildSurface(): boolean {
    if (this._hasReferenceImports || this.hasExactCallableChildSurface) {
      return true;
    }
    const value = this.value;
    for (let i = this.rulesIndexed; i < value.length; i++) {
      const child = childCallableRulesOf(value[i]!);
      if (child && rulesMayContainExactCallableSurface(child)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Lazily create registries for types as needed.
   */
  private _ensureDeclarationRegistry(): Registries.DeclarationRegistry {
    return (this.declarationRegistry ??= new Registries.DeclarationRegistry(this));
  }

  private _ensureFunctionRegistry(): Registries.FunctionRegistry {
    return (this.functionRegistry ??= new Registries.FunctionRegistry(this));
  }

  register(type: 'declaration', node: Declaration): void;
  register(type: 'mixin', node: Mixin | Ruleset): void;
  register(type: 'function', node: Func | JsFunction): void;
  register(
    type: 'declaration' | 'mixin' | 'function',
    node: Declaration | Mixin | Ruleset | Func | JsFunction
  ): void {
    switch (type) {
      case 'declaration':
        if (!isNode(node, N.Declaration) && !isNode(node, N.VarDeclaration)) {
          throw new TypeError(`Expected declaration registry node, got ${node.type}`);
        }
        this._ensureDeclarationRegistry().add(node);
        return;
      case 'mixin':
        if (!isNode(node, N.Mixin) && !isNode(node, N.Ruleset)) {
          throw new TypeError(`Expected mixin registry node, got ${node.type}`);
        }
        // Callable lookup is registryless. Keep the public overload as a
        // compatibility no-op instead of constructing/populating MixinRegistry.
        return;
      case 'function':
        if (!isNode(node, N.Func) && !isNode(node, N.JsFunction)) {
          throw new TypeError(`Expected function registry node, got ${node.type}`);
        }
        this._ensureFunctionRegistry().add(node);
    }
  }

  getRegistry(type: 'declaration'): Registries.DeclarationRegistry;
  getRegistry(type: 'mixin'): Registries.MixinRegistry;
  getRegistry(type: 'function'): Registries.FunctionRegistry;
  getRegistry(type: 'declaration' | 'mixin' | 'function'): Registries.DeclarationRegistry | Registries.MixinRegistry | Registries.FunctionRegistry;
  getRegistry(type: 'declaration' | 'mixin' | 'function') {
    const registry = type === 'declaration'
      ? this._ensureDeclarationRegistry()
      : type === 'mixin'
        ? new Registries.MixinRegistry(this)
        : this._ensureFunctionRegistry();
    if (this.rulesIndexed < this.value.length) {
      this._indexRules();
    } else {
      // Even when no re-indexing is needed (empty or fully indexed), ensure
      // fast maps are defined so the hot-path can distinguish an indexed scope
      // from one that has never been accessed via getRegistry at all.
      this.varsByName ??= new Map();
    }
    return registry;
  }

  /**
   * Fast parent-chain walk for static-named callable mixin lookup.
   *
   * Covers callable entries from the lazy callable cache:
   * static Mixins plus static Ruleset-as-mixin keys.
   * Compound / namespace cases use the registryless namespace path in
   * `find(...)`.
   */
  findMixinsFast(
    key: string,
    options?: {
      context?: Context;
      hasTarget?: boolean;
      local?: boolean;
      includeRulesets?: boolean;
      searchParents?: boolean;
      skipCurrentSurface?: boolean;
    }
  ): MixinEntry[] {
    const collectWithinScopeSurface = (
      scope: Rules,
      localContext: boolean | undefined,
      results: MixinEntry[],
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
          for (let i = candidates.length - 1; i >= 0; i--) {
            const entry = candidates[i]!;
            if (entry.match.length !== 0) {
              continue;
            }
            const candidate = entry.value;
            if (!options?.includeRulesets && isNode(candidate, N.Ruleset)) {
              continue;
            }
            results.push(candidate);
          }
        }
      }

      const childEntries = scope.directChildRuleEntries !== undefined
        ? (scope.directChildRuleEntries ?? undefined)
        : scope.rulesIndexed >= scope.value.length && !scope.hasExactCallableChildSurface
          ? undefined
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
        if (entry.node.options?.forward) {
          continue;
        }
        if (localContext && entry.node.options?.local) {
          continue;
        }

        visited = collectWithinScopeSurface(
          entry.node,
          localContext || Boolean(entry.node.options?.local),
          results,
          visited,
          true
        );
      }

      return visited;
    };

    const results: MixinEntry[] = [];
    let cursor: Node | undefined = this;
    let first = true;
    while (cursor) {
      if (isNode(cursor, N.Rules)) {
        const scope = cursor as Rules;
        if (!first) {
          if (Registries.isNonClassicImportBoundary(scope)) {
            break;
          }
        }
        first = false;
        collectWithinScopeSurface(
          scope,
          options?.local,
          results,
          undefined,
          options?.skipCurrentSurface !== true
        );
      }
      cursor = cursor.parent;
      if (options?.searchParents === false) {
        break;
      }
    }
    return results;
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
    bucket: CallableLookupEntry[]
  ): void {
    const candidateKeys = keys.filter(key => typeof key === 'string' && !key.startsWith(':'));
    const startIndex = candidateKeys.findIndex(key => !key.startsWith('*'));
    if (startIndex === -1) {
      return;
    }
    this.addCallableEntry(
      lookupKey,
      candidateKeys[startIndex],
      ruleset,
      candidateKeys.slice(startIndex + 1),
      bucket
    );
  }

  private collectCallableEntriesForKeyFrom(
    rules: Rules,
    lookupKey: string,
    bucket: CallableLookupEntry[]
  ): void {
    const value = rules.value;
    for (let i = 0; i < value.length; i++) {
      const node = value[i]!;
      if (isNode(node, N.Mixin)) {
        const name = node.value.name;
        if (name && name.type !== 'Interpolated') {
          this.addCallableEntry(lookupKey, String(name.valueOf()), node, [], bucket);
        }
        continue;
      }
      if (!isNode(node, N.Ruleset)) {
        continue;
      }
      let selector = node.value.selector;
      if (isNode(selector, N.Nil)) {
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
      selector = (
        Registries.getOrderedSelectorKeys(selector).length > 0
          ? selector
          : (sourceSelector && Registries.getOrderedSelectorKeys(sourceSelector).length > 0 ? sourceSelector : selector)
      );
      if (isNode(selector, N.SelectorList)) {
        for (let selectorIndex = 0; selectorIndex < selector.value.length; selectorIndex++) {
          this.addDirectCallableSelectorEntries(
            lookupKey,
            node,
            Registries.getOrderedSelectorKeys(selector.value[selectorIndex]!),
            bucket
          );
        }
        continue;
      }
      let keys = Registries.getOrderedSelectorKeys(selector);
      if (keys.length > 0 && ownSelector && !isNode(ownSelector, N.Nil)) {
        const parentSelector = isNode(node.parent?.parent, N.Ruleset)
          ? (node.parent.parent as Ruleset).value.selector
          : undefined;
        const parentKeys = parentSelector && !isNode(parentSelector, N.Nil)
          ? Registries.getOrderedSelectorKeys(parentSelector)
          : [];
        if (
          parentKeys.length > 0
          && keys.length > parentKeys.length
          && keysStartWith(keys, parentKeys)
        ) {
          keys = keys.slice(parentKeys.length);
        }
      }
      this.addDirectCallableSelectorEntries(lookupKey, node, keys, bucket);
    }
  }

  private getCallableEntriesForKey(lookupKey: string): CallableLookupEntry[] {
    const entries = this.callableLookupCache;
    const cached = entries?.get(lookupKey);
    if (cached) {
      return cached;
    }

    const bucket: CallableLookupEntry[] = [];
    this.collectCallableEntriesForKeyFrom(this, lookupKey, bucket);
    const sourceRules = sourceRulesOf(this);
    if (bucket.length === 0 && sourceRules !== this) {
      this.collectCallableEntriesForKeyFrom(sourceRules, lookupKey, bucket);
    }
    if (bucket.length > 0) {
      (this.callableLookupCache ??= new Map()).set(lookupKey, bucket);
    }
    if (this._scopeFrame) {
      this._scopeFrame.callableBucketsByName = this.callableLookupCache;
      this._scopeFrame.callablesCovered = true;
      this._scopeFrame.callableMissesCovered = !this.hasDirectLookupChildSurface();
    }
    return bucket;
  }

  private prepareCallableLookupFrame(frame: ScopeFrame, key: string): void {
    if (isNode(frame.rulesNode, N.Rules)) {
      const rules = frame.rulesNode;
      rules.getCallableEntriesForKey(key);
      frame.callableBucketsByName = rules.callableLookupCache;
      frame.callablesCovered = true;
      frame.callableMissesCovered = !rules.hasDirectLookupChildSurface();
    }
  }

  private collectDirectChildRulesEntries(): Array<{ node: Rules; rulesVisibility?: RulesOptions['rulesVisibility'] }> | undefined {
    if (this.directChildRuleEntries !== undefined) {
      return this.directChildRuleEntries ?? undefined;
    }
    if (this.rulesIndexed >= this.value.length && !this.hasExactCallableChildSurface) {
      this.directChildRuleEntries = null;
      return undefined;
    }
    let out: Array<{ node: Rules; rulesVisibility?: RulesOptions['rulesVisibility'] }> | undefined;
    const value = this.value;
    for (let i = 0; i < value.length; i++) {
      const child = childCallableRulesOf(value[i]!);
      if (!child) {
        continue;
      }
      if (!rulesMayContainExactCallableSurface(child)) {
        continue;
      }
      const rulesVisibility: RulesOptions['rulesVisibility'] = {
        ...child.options.rulesVisibility
      };
      rulesVisibility.Declaration ??= 'public';
      rulesVisibility.Ruleset ??= 'public';
      rulesVisibility.Mixin ??= 'public';
      (out ??= []).push({
        node: child,
        rulesVisibility
      });
    }
    this.directChildRuleEntries = out ?? null;
    return out;
  }

  private addDirectChildRuleEntry(
    child: Rules,
    rulesVisibility?: RulesOptions['rulesVisibility']
  ): void {
    this.hasDirectChildRuleSurface = true;
    if (rulesMayContainExactCallableSurface(child)) {
      this.hasExactCallableChildSurface = true;
    }
    const visibility: RulesOptions['rulesVisibility'] = {
      ...child.options.rulesVisibility,
      ...rulesVisibility
    };
    visibility.Declaration ??= 'public';
    visibility.Ruleset ??= 'public';
    visibility.Mixin ??= 'public';

    if (this.directChildRuleEntries === undefined) {
      return;
    }
    const entries = this.directChildRuleEntries ?? (this.directChildRuleEntries = []);
    entries.push({
      node: child,
      rulesVisibility: visibility
    });
  }

  findMixinsDirect(
    key: string,
    options?: {
      context?: Context;
      hasTarget?: boolean;
      local?: boolean;
      includeRulesets?: boolean;
      searchParents?: boolean;
    }
  ): MixinEntry[] {
    return (
      this.find(
        'mixin',
        key,
        options?.includeRulesets === false ? 'Mixin' : undefined,
        options
      ) as MixinEntry[] | undefined
    ) ?? [];
  }

  private getRegistrylessMixinCacheKey(
    keys: string | string[],
    filterType: string | undefined,
    options: Registries.FindOptions
  ): string | undefined {
    const mapCache = process.env.JESS_REGISTRYLESS_MIXIN_CACHE === '1';
    const lastCache = process.env.JESS_REGISTRYLESS_MIXIN_LAST_CACHE !== '0';
    if (!mapCache && !lastCache) {
      return undefined;
    }
    if (options.hasTarget || options.local || options.context?.rulesContext === this) {
      return undefined;
    }
    const lookupKey = isArray(keys) ? keys.join(REGISTRYLESS_MIXIN_PATH_KEY_SEPARATOR) : keys;
    return lookupKey
      + REGISTRYLESS_MIXIN_CACHE_KEY_SEPARATOR
      + (filterType ?? '')
      + REGISTRYLESS_MIXIN_CACHE_KEY_SEPARATOR
      + (options.terminalMixinOnly === true ? 't1' : 't0')
      + REGISTRYLESS_MIXIN_CACHE_KEY_SEPARATOR
      + (options.searchParents === false ? 's0' : 's1');
  }

  private hasRegistrylessMixinCacheResult(key: string): boolean {
    if (process.env.JESS_REGISTRYLESS_MIXIN_CACHE !== '1') {
      return this.registrylessLastMixinLookupKey === key;
    }
    return this.registrylessMixinLookupCache?.has(key) ?? false;
  }

  private getRegistrylessMixinCacheResult(key: string): MixinEntry[] | undefined {
    if (process.env.JESS_REGISTRYLESS_MIXIN_CACHE !== '1') {
      return this.registrylessLastMixinLookupValue;
    }
    return this.registrylessMixinLookupCache?.get(key);
  }

  private setRegistrylessMixinCacheResult(key: string | undefined, value: MixinEntry[] | undefined): void {
    if (key === undefined) {
      return;
    }
    if (process.env.JESS_REGISTRYLESS_MIXIN_CACHE !== '1') {
      this.registrylessLastMixinLookupKey = key;
      this.registrylessLastMixinLookupValue = value;
      return;
    }
    if (process.env.JESS_REGISTRYLESS_MIXIN_CACHE === '1') {
      (this.registrylessMixinLookupCache ??= new Map()).set(key, value);
    }
  }

  private findVisibleExactCallableRulesetPath(
    path: string[],
    options?: {
      hasTarget?: boolean;
      local?: boolean;
      searchParents?: boolean;
    }
  ): Ruleset[] {
    const searchSurface = (
      scope: Rules,
      localContext: boolean | undefined,
      visited: Set<Rules>
    ): Ruleset[] => {
      if (visited.has(scope)) {
        return [];
      }
      visited.add(scope);

      if (scope.rulesIndexed < scope.value.length) {
        scope._indexRules();
      }

      const results: Ruleset[] = [];
      for (let i = scope.value.length - 1; i >= 0; i--) {
        const candidate = scope.value[i]!;
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

      const childEntries = scope._rulesSet as Array<{
        node: Rules;
        rulesVisibility?: RulesOptions['rulesVisibility'];
      }> | undefined;
      if (!childEntries?.length) {
        return results;
      }

      for (let i = childEntries.length - 1; i >= 0; i--) {
        const entry = childEntries[i]!;
        if (!canEnterRulesEntryForLookup(entry, { type: 'Mixin', hasTarget: options?.hasTarget })) {
          continue;
        }
        if (entry.node.options?.forward) {
          continue;
        }
        if (localContext && entry.node.options?.local) {
          continue;
        }
        const nested = searchSurface(
          entry.node,
          localContext || Boolean(entry.node.options?.local),
          visited
        );
        for (let nestedIndex = 0; nestedIndex < nested.length; nestedIndex++) {
          results.push(nested[nestedIndex]!);
        }
      }

      return results;
    };

    const results: Ruleset[] = [];
    let cursor: Node | undefined = this;
    let first = true;
    while (cursor) {
      if (isNode(cursor, N.Rules)) {
        const scope = cursor as Rules;
        if (!first) {
          if (Registries.isNonClassicImportBoundary(scope)) {
            break;
          }
        }
        first = false;
        const surfaceResults = searchSurface(scope, options?.local, new Set<Rules>());
        for (let resultIndex = 0; resultIndex < surfaceResults.length; resultIndex++) {
          results.push(surfaceResults[resultIndex]!);
        }
      }
      if (options?.searchParents === false) {
        break;
      }
      cursor = cursor.parent;
    }
    return results;
  }

  private findVisibleCallableRulesetPrefixMatches(
    path: string[],
    options?: {
      hasTarget?: boolean;
      local?: boolean;
      searchParents?: boolean;
    }
  ): Array<{ ruleset: Ruleset; consumed: string[] }> {
    const searchSurface = (
      scope: Rules,
      localContext: boolean | undefined,
      visited: Set<Rules>
    ): Array<{ ruleset: Ruleset; consumed: string[] }> => {
      if (visited.has(scope)) {
        return [];
      }
      visited.add(scope);

      if (scope.rulesIndexed < scope.value.length) {
        scope._indexRules();
      }

      const results: Array<{ ruleset: Ruleset; consumed: string[] }> = [];
      for (let i = scope.value.length - 1; i >= 0; i--) {
        const candidate = scope.value[i]!;
        if (!isNode(candidate, N.Ruleset)) {
          continue;
        }
        const keyPaths = getCallableRulesetKeyPaths(candidate);
        for (let keyPathIndex = 0; keyPathIndex < keyPaths.length; keyPathIndex++) {
          const keys = keyPaths[keyPathIndex]!;
          if (
            keys.length > 0
            && keys.length < path.length
            && keysStartWith(keys, path)
          ) {
            results.push({ ruleset: candidate, consumed: keys });
          }
        }
      }

      const childEntries = scope._rulesSet as Array<{
        node: Rules;
        rulesVisibility?: RulesOptions['rulesVisibility'];
      }> | undefined;
      if (!childEntries?.length) {
        return results;
      }

      for (let i = childEntries.length - 1; i >= 0; i--) {
        const entry = childEntries[i]!;
        if (!canEnterRulesEntryForLookup(entry, { type: 'Mixin', hasTarget: options?.hasTarget })) {
          continue;
        }
        if (entry.node.options?.forward) {
          continue;
        }
        if (localContext && entry.node.options?.local) {
          continue;
        }
        const nested = searchSurface(
          entry.node,
          localContext || Boolean(entry.node.options?.local),
          visited
        );
        for (let nestedIndex = 0; nestedIndex < nested.length; nestedIndex++) {
          results.push(nested[nestedIndex]!);
        }
      }

      return results;
    };

    const results: Array<{ ruleset: Ruleset; consumed: string[] }> = [];
    let cursor: Node | undefined = this;
    let first = true;
    while (cursor) {
      if (isNode(cursor, N.Rules)) {
        const scope = cursor as Rules;
        if (!first) {
          if (Registries.isNonClassicImportBoundary(scope)) {
            break;
          }
        }
        first = false;
        const surfaceResults = searchSurface(scope, options?.local, new Set<Rules>());
        for (let resultIndex = 0; resultIndex < surfaceResults.length; resultIndex++) {
          results.push(surfaceResults[resultIndex]!);
        }
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
    options: Registries.FindOptions = {}
  ): MixinEntry[] | undefined {
    if (keys.length < 2) {
      return undefined;
    }

    const DEFINITE_MISS = Symbol('definite-mixin-namespace-miss');
    type NamespaceFastResult = MixinEntry[] | typeof DEFINITE_MISS | undefined;

    const walk = (
      scope: Rules,
      path: string[],
      offset: number,
      searchParents: boolean
    ): NamespaceFastResult => {
      const segment = path[offset];
      const restLength = path.length - offset - 1;
      if (!segment) {
        return DEFINITE_MISS;
      }

      const matches = scope.findMixinsFast(segment, {
        context: options.context,
        hasTarget: options.hasTarget,
        local: options.local,
        includeRulesets: restLength === 0 && filterType !== 'Mixin' && options.terminalMixinOnly !== true,
        searchParents
      });

      if (matches.length === 0) {
        return DEFINITE_MISS;
      }
      if (restLength === 0) {
        return matches;
      }

      const nestedResults: MixinEntry[] = [];
      let sawDefiniteMiss = false;
      for (const match of matches) {
        if (!isNode(match, N.Mixin)) {
          return undefined;
        }
        if (!mixinHasNoRequiredParams(match)) {
          sawDefiniteMiss = true;
          continue;
        }
        const resolved = walk(match.value.rules, path, offset + 1, false);
        if (resolved === undefined) {
          return undefined;
        }
        if (resolved === DEFINITE_MISS) {
          sawDefiniteMiss = true;
          continue;
        }
        for (let resolvedIndex = 0; resolvedIndex < resolved.length; resolvedIndex++) {
          nestedResults.push(resolved[resolvedIndex]!);
        }
      }

      if (nestedResults.length > 0) {
        return nestedResults;
      }
      return sawDefiniteMiss ? DEFINITE_MISS : undefined;
    };

    const result = walk(this, keys, 0, true);
    return result === DEFINITE_MISS ? [] : result;
  }

  private findRulesetNamespacePathFast(
    keys: string[],
    options: Registries.FindOptions = {}
  ): MixinEntry[] | undefined {
    if (keys.length < 2) {
      return undefined;
    }

    const DEFINITE_MISS = Symbol('definite-ruleset-namespace-miss');
    type RulesetNamespaceFastResult = MixinEntry[] | typeof DEFINITE_MISS | undefined;
    const selectorNeedsLegacyFallback = (ruleset: Ruleset): boolean => {
      return blocksAmbientMixinOutputLookup(ruleset.value.rules);
    };

    const walk = (
      scope: Rules,
      path: string[],
      searchParents: boolean
    ): RulesetNamespaceFastResult => {
      const [segment] = path;
      if (!segment) {
        return DEFINITE_MISS;
      }
      if (scope.findMixinsFast(segment, {
        context: options.context,
        hasTarget: options.hasTarget,
        local: options.local,
        includeRulesets: false,
        searchParents
      }).length > 0) {
        return undefined;
      }

      const prefixMatches = scope.findVisibleCallableRulesetPrefixMatches(path, {
        hasTarget: options.hasTarget,
        local: options.local,
        searchParents
      });
      if (prefixMatches.length === 0) {
        const exactPathMatches = scope.findVisibleExactCallableRulesetPath(path, {
          hasTarget: options.hasTarget,
          local: options.local,
          searchParents
        });
        return exactPathMatches.length > 0 ? exactPathMatches : DEFINITE_MISS;
      }

      prefixMatches.sort((a, b) => b.consumed.length - a.consumed.length);
      let sawLegacyOnlyPrefix = false;

      for (const { ruleset, consumed } of prefixMatches) {
        if (selectorNeedsLegacyFallback(ruleset)) {
          sawLegacyOnlyPrefix = true;
          continue;
        }
        const remainderLength = path.length - consumed.length;
        if (remainderLength === 0) {
          return options.terminalMixinOnly === true ? DEFINITE_MISS : [ruleset];
        }
        const resolved = remainderLength === 1
          ? (() => {
              const segment = path[consumed.length]!;
              const simpleCallableMatches = ruleset.value.rules.findMixinsFast(segment, {
                context: options.context,
                hasTarget: options.hasTarget,
                local: options.local,
                includeRulesets: options.terminalMixinOnly !== true,
                searchParents: false
              });
              if (simpleCallableMatches.length > 0) {
                return simpleCallableMatches;
              }
              if (options.terminalMixinOnly === true) {
                return undefined;
              }
              const simpleCallableRulesets = ruleset.value.rules.findVisibleExactCallableRulesetPath([segment], {
                hasTarget: options.hasTarget,
                local: options.local,
                searchParents: false
              });
              return simpleCallableRulesets.length > 0 ? simpleCallableRulesets : undefined;
            })()
          : ruleset.value.rules.find(
              'mixin',
              collectKeyRemainder(path, consumed.length),
              undefined,
              {
                ...options,
                searchParents: false
              }
            );
        if (resolved?.length) {
          return resolved;
        }
      }

      return sawLegacyOnlyPrefix ? undefined : DEFINITE_MISS;
    };

    const result = walk(this, keys, true);
    return result === DEFINITE_MISS ? [] : result;
  }

  private findCompoundPrefixCallableRulesetPathFast(
    keys: string[],
    options: Registries.FindOptions = {}
  ): MixinEntry[] | undefined {
    if (keys.length < 2) {
      return undefined;
    }

    const prefixMatches = this.findVisibleCallableRulesetPrefixMatches(keys, {
      hasTarget: options.hasTarget,
      local: options.local
    });
    if (prefixMatches.length === 0) {
      return [];
    }

    prefixMatches.sort((a, b) => {
      if (b.consumed.length !== a.consumed.length) {
        return b.consumed.length - a.consumed.length;
      }
      return 0;
    });

    for (const { ruleset, consumed } of prefixMatches) {
      const remainderLength = keys.length - consumed.length;
      if (remainderLength === 0) {
        return options.terminalMixinOnly === true ? [] : [ruleset];
      }
      const resolved = ruleset.value.rules.find(
        'mixin',
        remainderLength === 1 ? keys[consumed.length]! : collectKeyRemainder(keys, consumed.length),
        undefined,
        {
          ...options,
          searchParents: false
        }
      );
      if (resolved?.length) {
        return resolved;
      }
    }

    return [];
  }

  private findCallableDescendantsWithinMixinNamespaces(
    namespaceMixins: MixinEntry[],
    keys: string[],
    options: Registries.FindOptions = {}
  ): MixinEntry[] | undefined {
    if (keys.length < 2 || namespaceMixins.length === 0) {
      return undefined;
    }

    const remainder = collectKeyRemainder(keys, 1);
    const orderedNamespaceMixins: Mixin[] = [];
    for (let i = 0; i < namespaceMixins.length; i++) {
      const entry = namespaceMixins[i]!;
      if (!isNode(entry, N.Mixin)) {
        continue;
      }
      orderedNamespaceMixins.push(entry);
    }

    const resolved: MixinEntry[] = [];
    for (const entry of orderedNamespaceMixins) {
      if (!mixinHasNoRequiredParams(entry)) {
        continue;
      }
      const nested = entry.value.rules.findMixin(remainder, undefined, {
        ...options,
        searchParents: false
      });
      if (nested?.length) {
        for (let nestedIndex = 0; nestedIndex < nested.length; nestedIndex++) {
          resolved.push(nested[nestedIndex]!);
        }
      }
    }

    return resolved;
  }

  findMixin(
    keys: string | string[],
    filterType?: string,
    options: Registries.FindOptions = {}
  ): MixinEntry[] | undefined {
    if (typeof keys === 'string') {
      const includeRulesets = filterType !== 'Mixin' && options.terminalMixinOnly !== true;
      const cacheKey = this.getRegistrylessMixinCacheKey(keys, filterType, options);
      if (cacheKey !== undefined && this.hasRegistrylessMixinCacheResult(cacheKey)) {
        return this.getRegistrylessMixinCacheResult(cacheKey);
      }
      const callableFrame = this._scopeFrame;
      if (callableFrame && !options.hasTarget && !options.local) {
        this.prepareCallableLookupFrame(callableFrame, keys);
        const frameHit = lookupScopeFrameCallable(callableFrame, keys, {
          includeRulesets,
          searchParents: false
        });
        if (frameHit.kind === 'miss' && options.searchParents === false) {
          const pathKeys = splitStaticCallablePathKey(keys);
          if (pathKeys) {
            const result = this.findMixin(pathKeys, filterType, options);
            this.setRegistrylessMixinCacheResult(cacheKey, result);
            return result;
          }
          this.setRegistrylessMixinCacheResult(cacheKey, undefined);
          return undefined;
        }
        if (frameHit.kind === 'hit') {
          const bucket = frameHit.bucket;
          const results: MixinEntry[] = [];
          for (let i = bucket.length - 1; i >= 0; i--) {
            const entry = bucket[i]!;
            if (entry.match.length !== 0) {
              continue;
            }
            const candidate = entry.value;
            if (!includeRulesets && isNode(candidate, N.Ruleset)) {
              continue;
            }
            results.push(candidate);
          }
          if (results.length > 0) {
            this.setRegistrylessMixinCacheResult(cacheKey, results);
            return results;
          }
        }
        if (frameHit.kind === 'uncovered') {
          const direct = this.findMixinsFast(keys, {
            context: options.context,
            hasTarget: options.hasTarget,
            local: options.local,
            includeRulesets,
            searchParents: false,
            skipCurrentSurface: true
          });
          if (direct.length > 0) {
            this.setRegistrylessMixinCacheResult(cacheKey, direct);
            return direct;
          }
        }
        if (frameHit.kind === 'miss' || frameHit.kind === 'uncovered') {
          let retryFrame = callableFrame.parent;
          let fallbackFrame = callableFrame.fallbackFrame;
          while (retryFrame) {
            let retryHit = lookupScopeFrameCallable(retryFrame, keys, {
              includeRulesets,
              searchParents: false
            });
            if (retryHit.kind === 'uncovered' && isNode(retryFrame.rulesNode, N.Rules)) {
              this.prepareCallableLookupFrame(retryFrame, keys);
              retryHit = lookupScopeFrameCallable(retryFrame, keys, {
                includeRulesets,
                searchParents: false
              });
            }
            if (retryHit.kind === 'hit') {
              const bucket = retryHit.bucket;
              const results: MixinEntry[] = [];
              for (let i = bucket.length - 1; i >= 0; i--) {
                const entry = bucket[i]!;
                if (entry.match.length !== 0) {
                  continue;
                }
                const candidate = entry.value;
                if (!includeRulesets && isNode(candidate, N.Ruleset)) {
                  continue;
                }
                results.push(candidate);
              }
              if (results.length > 0) {
                this.setRegistrylessMixinCacheResult(cacheKey, results);
                return results;
              }
            }
            if (retryHit.kind === 'uncovered' && isNode(retryFrame.rulesNode, N.Rules)) {
              const direct = retryFrame.rulesNode.findMixinsFast(keys, {
                context: options.context,
                hasTarget: options.hasTarget,
                local: options.local,
                includeRulesets,
                searchParents: false,
                skipCurrentSurface: true
              });
              if (direct.length > 0) {
                this.setRegistrylessMixinCacheResult(cacheKey, direct);
                return direct;
              }
            }
            retryFrame = retryFrame.parent;
            if (!retryFrame && fallbackFrame) {
              retryFrame = fallbackFrame;
              fallbackFrame = fallbackFrame.fallbackFrame;
            }
          }
          if (frameHit.kind === 'miss' && this.parent === undefined) {
            const pathKeys = splitStaticCallablePathKey(keys);
            if (pathKeys) {
              const result = this.findMixin(pathKeys, filterType, options);
              this.setRegistrylessMixinCacheResult(cacheKey, result);
              return result;
            }
            this.setRegistrylessMixinCacheResult(cacheKey, undefined);
            return undefined;
          }
        }
      }
      const pathKeys = splitStaticCallablePathKey(keys);
      if (pathKeys) {
        const result = this.findMixin(pathKeys, filterType, options);
        this.setRegistrylessMixinCacheResult(cacheKey, result);
        return result;
      }
      const direct = this.findMixinsFast(keys, {
        context: options.context,
        hasTarget: options.hasTarget,
        local: options.local,
        includeRulesets,
        searchParents: options.searchParents
      });
      const result = direct.length > 0 ? direct : undefined;
      this.setRegistrylessMixinCacheResult(cacheKey, result);
      return result;
    } else if (isArray(keys) && keys.length === 0) {
      return undefined;
    } else if (isArray(keys) && keys.length === 1) {
      return this.findMixin(keys[0]!, filterType, options);
    } else if (isArray(keys) && keys.length > 1) {
      const cacheKey = this.getRegistrylessMixinCacheKey(keys, filterType, options);
      if (cacheKey !== undefined && this.hasRegistrylessMixinCacheResult(cacheKey)) {
        return this.getRegistrylessMixinCacheResult(cacheKey);
      }
      const mixinFilterType = filterType === 'Mixin' ? 'Mixin' : undefined;
      let compoundPrefixFast: MixinEntry[] | undefined;
      let mixinNamespaceFast: MixinEntry[] | undefined;
      if (mixinFilterType !== 'Mixin') {
        const rulesetNamespaceFast = this.findRulesetNamespacePathFast(keys, options);
        if (rulesetNamespaceFast !== undefined && (rulesetNamespaceFast.length > 0 || options.terminalMixinOnly !== true)) {
          const result = rulesetNamespaceFast.length > 0 ? rulesetNamespaceFast : undefined;
          this.setRegistrylessMixinCacheResult(cacheKey, result);
          return result;
        }
        const namespaceMixins = this.findMixinsFast(keys[0]!, {
          context: options.context,
          hasTarget: options.hasTarget,
          local: options.local,
          includeRulesets: false
        });
        const namespaceRulesets = this.findVisibleExactCallableRulesetPath([keys[0]!], {
          hasTarget: options.hasTarget,
          local: options.local
        });
        if (namespaceMixins.length === 0 && namespaceRulesets.length === 0) {
          if (options.terminalMixinOnly !== true) {
            const exactRulesetPath = this.findVisibleExactCallableRulesetPath(keys, {
              hasTarget: options.hasTarget,
              local: options.local
            });
            if (exactRulesetPath.length > 0) {
              return exactRulesetPath;
            }
          }
        }
        if (namespaceMixins.length === 0 && namespaceRulesets.length > 0) {
          const rulesetNamespaceFast = this.findRulesetNamespacePathFast(keys, options);
          if (rulesetNamespaceFast !== undefined && (rulesetNamespaceFast.length > 0 || options.terminalMixinOnly !== true)) {
            return rulesetNamespaceFast.length > 0 ? rulesetNamespaceFast : undefined;
          }
        }
        if (namespaceMixins.length > 0) {
          compoundPrefixFast = this.findCompoundPrefixCallableRulesetPathFast(keys, options);
          mixinNamespaceFast = this.findCallableDescendantsWithinMixinNamespaces(
            namespaceMixins,
            keys,
            options
          );
        }
      }
      const fast = mixinNamespaceFast ?? this.findMixinNamespacePathFast(keys, mixinFilterType, options);
      if (compoundPrefixFast !== undefined && compoundPrefixFast.length > 0) {
        if (fast !== undefined && fast.length > 0) {
          const combined = new Array<MixinEntry>();
          for (let i = 0; i < compoundPrefixFast.length; i++) {
            combined.push(compoundPrefixFast[i]!);
          }
          for (let i = 0; i < fast.length; i++) {
            const node = fast[i]!;
            let found = false;
            for (let existing = 0; existing < combined.length; existing++) {
              if (combined[existing] === node) {
                found = true;
                break;
              }
            }
            if (!found) {
              combined.push(node);
            }
          }
          return combined;
        }
        return compoundPrefixFast;
      }
      if (fast !== undefined) {
        const result = fast.length > 0 ? fast : undefined;
        this.setRegistrylessMixinCacheResult(cacheKey, result);
        return result;
      }
      this.setRegistrylessMixinCacheResult(cacheKey, undefined);
      return undefined;
    }
    return undefined;
  }

  findDeclaration(
    keys: string,
    filterType?: string,
    options: Registries.DeclarationFindOptions = {}
  ): ReturnType<Registries.DeclarationRegistry['find']> | undefined {
    if (process.env.JESS_DIRECT_DECLARATION_LOOKUP === '1') {
      const direct = findDeclarationDirect(
        this,
        keys,
        normalizeDeclarationFilter(filterType),
        options
      );
      if (direct !== DIRECT_DECLARATION_LOOKUP_UNCOVERED) {
        return direct;
      }
    }
    return this.getRegistry('declaration').find(keys, normalizeDeclarationFilter(filterType), options);
  }

  findVariable(
    keys: string,
    options?: Registries.DeclarationFindOptions
  ): VarDeclaration | undefined {
    const found = this.findDeclaration(keys, 'VarDeclaration', options);
    return isNode(found, N.VarDeclaration) ? found : undefined;
  }

  findProperty(
    keys: string,
    options?: Registries.DeclarationFindOptions
  ): Declaration | undefined {
    const found = this.findDeclaration(keys, 'Declaration', options);
    return isNode(found, N.Declaration) ? found : undefined;
  }

  findFunction(
    keys: string,
    filterType?: string,
    options?: Registries.FindOptions
  ): ReturnType<Registries.FunctionRegistry['find']> | undefined {
    return this.getRegistry('function').find(keys, filterType, options);
  }

  /**
   * Compatibility wrapper for public callers. Production code should prefer the
   * typed find* methods above so it does not route through a string type switch.
   */
  find(type: 'declaration', keys: string, filterType?: string, options?: Registries.DeclarationFindOptions): ReturnType<Registries.DeclarationRegistry['find']> | undefined;
  find(type: 'mixin', keys: string | string[], filterType?: string, options?: Registries.FindOptions): MixinEntry[] | undefined;
  find(type: 'function', keys: string, filterType?: string, options?: Registries.FindOptions): ReturnType<Registries.FunctionRegistry['find']> | undefined;
  find(type: 'declaration' | 'mixin' | 'function', key: string, filterType: string, options?: Registries.FindOptions): ReturnType<Registries.DeclarationRegistry['find']> | MixinEntry[] | ReturnType<Registries.FunctionRegistry['find']> | undefined;
  find(
    type: 'declaration' | 'mixin' | 'function',
    keys: string | string[],
    filterType?: string,
    options: Registries.FindOptions = {}
  ): ReturnType<Registries.DeclarationRegistry['find']> | MixinEntry[] | ReturnType<Registries.FunctionRegistry['find']> | undefined {
    switch (type) {
      case 'declaration':
        if (typeof keys !== 'string') {
          throw new TypeError('Declaration lookup keys must be a string');
        }
        return this.findDeclaration(keys, filterType, options);
      case 'mixin':
        return this.findMixin(keys, filterType, options);
      case 'function':
        if (typeof keys !== 'string') {
          throw new TypeError('Function lookup keys must be a string');
        }
        return this.findFunction(keys, filterType, options);
    }
  }

  override toString(options?: PrintOptions): string {
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
        const charsetStr = printDetached(options, nextOptions => charset.toTrimmedString(nextOptions));
        w.add(charsetStr, charset);
        w.add('\n');
        // Do not permanently flip `charsetEmitted` here; restore at end.
        ctx.charsetEmitted = true;
      }
      if (ctx?.topImports?.length) {
        for (const node of this.value) {
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
        for (const node of this.value) {
          if (!isCommentLike(node)) {
            break;
          }
          const commentStr = printDetached(options, nextOptions => node.toTrimmedString(nextOptions));
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
            const importPrelude = importRule.value.prelude;
            if (importPrelude && String(importPrelude.valueOf?.() ?? '').includes('$')) {
              const maybePrelude = importPrelude.eval(ctx);
              if (!isThenable(maybePrelude)) {
                importRule.value.prelude = maybePrelude as Node;
              }
            }
          }
          const importStr = printDetached(options, nextOptions => importRule.toString(nextOptions));
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
    super(value ?? [], mergedOptions, location);
    this._sourceRoot = this;
    this._treeContext = treeContext;
  }

  /**
   * Used by Ruleset, Mixins, and AtRules etc to render
   * rules with braces.
   */
  toBraced(options?: PrintOptions) {
    let opts = getPrintOptions(options);
    // Use options.depth if provided, otherwise calculate from frameState
    const depth = opts.depth!;
    const w = opts.writer!;
    const mark = w.mark();
    let space = ''.padStart(depth * 2);
    w.add('{');
    w.add('\n');
    const saved = savePrintState(opts, ['depth']);
    opts.depth = depth + 1;
    this._emitSourceRulesBody(opts);
    restorePrintState(opts, saved);
    // ensure closing brace is on its own properly indented line
    w.add('\n');
    if (depth !== 0) {
      w.add(space);
    }
    w.add('}');
    // At root level (depth === 0), don't add a newline after the closing brace
    // The parent _emitRulesBody will add the newline before the next item
    // For nested rules (depth > 0), the newline is handled by the parent's _emitRulesBody
    return w.getSince(mark);
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
      if (node.value.length !== 1) {
        return false;
      }
      const only = node.value[0]!;
      return isNode(only, N.Any) && only.options.role === 'any';
    };
    const isBlockContainer = (node: Node): node is Ruleset | AtRule => {
      return isNode(node, N.Ruleset) || (isNode(node, N.AtRule) && Boolean(node.value.rules));
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
      const isContainer = n.type === 'Ruleset' || n.type === 'AtRule' || n.type === 'Rules';
      if (isContainer && n.type === 'Rules') {
        emitLeadingBlockCommentForNode(n);
      }
      if (referenceMode && !referenceRenderEnabled && !isContainer) {
        return;
      }
      const isChildRules = isNode(n, N.Rules);
      const isRulesetOrAtRule = isBlockContainer(n);
      // Add indentation only for simple nodes (declarations, etc.)
      // Ruleset and AtRule nodes indent themselves in renderOpening
      // Emit directly to preserve source map segments
      // For child Rules nodes, pass the same depth (don't increment depth)
      // Rules nodes inside Rules nodes are at the same level
      if (isChildRules) {
        let hasRenderableChild = false;
        for (let i = 0; i < n.value.length; i++) {
          const child = n.value[i]!;
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
        options.depth = depth;
        options.referenceMode = childReferenceMode;
        options.referenceRenderEnabled = childReferenceRenderEnabled;
        const childRule = w.preview(() => (
          mode === 'render' && context
            ? n.render(context, options)
            : n.toTrimmedString(options)
        ), true);
        const finishChildRule = (resolvedChildRule: string): void => {
          options.emittedTrivia = childEmittedTrivia;
          restorePrintState(options, childSaved);
          if (!resolvedChildRule) {
            return;
          }
          const prefix = !isRulesetOrAtRule && depth !== 0 ? space : undefined;
          emitCaptured(resolvedChildRule, n, prefix);
        };
        return isThenable(childRule)
          ? childRule.then(finishChildRule)
          : finishChildRule(childRule);
      }
      if (isRulesetOrAtRule) {
        emitLeadingBlockCommentForNode(n);
        emitBoundaryIfNeeded(n);
        const mark = w.mark();
        const containerSaved = savePrintState(options, ['depth', 'referenceMode', 'referenceRenderEnabled']);
        options.depth = depth;
        options.referenceMode = referenceMode;
        options.referenceRenderEnabled = referenceRenderEnabled;
        const rule = mode === 'render' && context
          ? n.render(context, getPrintOptions(options))
          : serializeRulesContainerInline(n, getPrintOptions(options));
        const finishRule = (resolvedRule: string): void => {
          if (!w.hasContentSince(mark) && resolvedRule) {
            w.add(resolvedRule, n);
          }
          restorePrintState(options, containerSaved);
          if (!w.hasContentSince(mark)) {
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
      const output = mode === 'render' && context
        ? n.render(context, options)
        : n.toTrimmedString(options);
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
    if (!this.visible && !this.fullRender) {
      return '';
    }
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    this._emitSourceRulesBody(options);
    return w.getSince(mark);
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
      for (let n of rules.value) {
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
    for (let i = 0; i < this.value.length; i++) {
      const node = this.value[i]!;
      if (node.visible) {
        out.push(node);
      }
    }
    return out;
  }

  hasVisibleRules(): boolean {
    for (let i = 0; i < this.value.length; i++) {
      if (this.value[i]!.visible) {
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
      for (let n of rules.value) {
        if (isNode(n, N.Declaration)) {
          let { name, value, important } = n.value;
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

  /** @todo - Refactor? */
  _rulesSet: RulesEntry[] | undefined;
  get rulesSet(): RulesEntry[] {
    return (this._rulesSet ??= []);
  }

  registerNode(node: Node, options?: Record<string, any>, context?: Context) {
    const rebuildCallableCache = this.callableLookupCache !== undefined || this._scopeFrame !== undefined;
    this.callableLookupCache = undefined;
    if (this._scopeFrame) {
      this._scopeFrame.callableBucketsByName = undefined;
      this._scopeFrame.callablesCovered = false;
      this._scopeFrame.callableMissesCovered = false;
    }
    this.directDeclarationsByName = undefined;
    this.directDeclarationLookupCache = undefined;
    this.registrylessMixinLookupCache = undefined;
    this.registrylessLastMixinLookupKey = undefined;
    this.registrylessLastMixinLookupValue = undefined;
    const directChildRules = childCallableRulesOf(node);
    if (directChildRules && !isNode(node, N.Rules)) {
      this.addDirectChildRuleEntry(directChildRules);
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
          this._scopeFrame.callableMissesCovered = false;
        }
      }
    }
    if (isNode(node, N.Rules)) {
      if (node.rulesIndexed < node.value.length) {
        node._indexRules();
      }

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
      this.rulesSet.push({
        node,
        rulesVisibility,
        readonly
      });
      this.addDirectChildRuleEntry(node, rulesVisibility);
      if (this._scopeFrame) {
        this._scopeFrame.callableMissesCovered = false;
      }
      if (node._hasExtends) {
        this._hasExtends = true;
      }
      if ((node.options as { referenceMode?: boolean } | undefined)?.referenceMode === true || node._hasReferenceImports) {
        this._hasReferenceImports = true;
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
        // Skip setDefined logic if we're currently indexing to avoid recursive calls
        if (this._indexing) {
          // We'll handle setDefined after indexing is complete
          return;
        }

        let key = node.value.name?.toString();
        /** Don't set within sibling rules */
        let opts: Registries.FindOptions = {};
        opts.searchParents = true;
        // Don't use start when searching parents - we want to find variables in parent regardless of position
        // start is only relevant for finding variables before the current node in the same Rules
        opts.start = undefined;
        // node.type is 'VarDeclaration' or 'Declaration', use it directly as filterType
        let result = this.findDeclaration(key, normalizeDeclarationFilter(node.type), opts);
        if (result) {
          if (result.options?.readonly || opts.readonly) {
            throw new ReferenceError(`"${key}" is readonly`);
          }
          if (isNode(node, N.VarDeclaration) && isNode(result, N.VarDeclaration)) {
            let assignedValue = node.value.value;
            if (context) {
              const evaluatedValue = assignedValue.eval(context);
              if (!isThenable(evaluatedValue)) {
                assignedValue = evaluatedValue;
              }
            }
            result.value.value = assignedValue;
            if (isNode(result.parent, N.Rules)) {
              assignScopeFrameVariable(result.parent.getScopeFrame(), key, assignedValue);
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
          const foundIndex = foundRules.value.indexOf(result);
          if (foundIndex !== -1) {
            foundRules.value.splice(foundIndex + 1, 0, newDeclaration);
          } else {
            // If not found in array, add at the beginning
            foundRules.value.unshift(newDeclaration);
          }

          // Re-run child bookkeeping for the inserted declaration. We skip
          // setDefined processing since we already removed the flag.
          foundRules.registerNode(newDeclaration);
        } else {
          throw new ReferenceError(`"${key}" is not defined`);
        }
      }

      this.register('declaration', node);
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
          const name = (node as VarDeclaration).value.name.valueOf();
          const map = (this.varsByName ??= new Map());
          let arr = map.get(name);
          if (!arr) {
            map.set(name, arr = []);
          }
          arr.push(node as VarDeclaration);
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
              bucket.push({
                cell: {
                  value: (node as VarDeclaration).value.value,
                  sourceNode: node,
                  readonly: node.options?.readonly
                },
                sourceNode: node as VarDeclaration
              });
            }
          }
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
        }
      }
    } else if (isNode(node, N.Ruleset) || isNode(node, N.Mixin)) {
      // Callable lookup is registryless: the lazy callable cache crawls
      // Rules.value directly and filters candidates at lookup/call time.
    } else if (isNode(node, N.Func)) {
      this.register('function', node);
    }
    if (rebuildCallableCache && !this._indexing && this._scopeFrame) {
      this._scopeFrame.callableBucketsByName = this.callableLookupCache;
    }
  }

  push(...nodes: Node[]) {
    for (let node of nodes) {
      this.adopt(node);
      this.value.push(node);
      this.registerNode(node);
    }
  }

  at(index: number) {
    let target = index;
    if (target < 0) {
      let indexedCount = 0;
      for (let i = 0; i < this.value.length; i++) {
        if (isIndexedRuleChild(this.value[i]!)) {
          indexedCount++;
        }
      }
      target = indexedCount + target;
      if (target < 0) {
        return undefined;
      }
    }
    let current = 0;
    for (let i = 0; i < this.value.length; i++) {
      const node = this.value[i]!;
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
    const parentAtRule = isNode(this.parent, N.AtRule) ? this.parent : undefined;
    return parentAtRule ? NESTABLE_AT_RULE_NAMES.has(parentAtRule.value.name.valueOf()) : false;
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
      if (isNode(node, N.Any) && node.options.role === 'charset') {
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
        rules.value[index] = placeholder;
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
        rules.value[index] = placeholder;
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
      for (let i = start; i < rules.value.length; i++) {
        const result = processNode(rules.value[i]!, i);
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
      && !node.options?.assign
      && !node.options?.normalizedFromAssign
    );
    const prepared = canReuseCanonicalDeclaration
      ? node.prepareRegistration(context, { reuseCanonical: true })
      : node.prepareRegistration(context);
    if (isThenable(prepared)) {
      return Promise.resolve(prepared).then((preparedNode) => {
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
    return isNode(node, N.VarDeclaration | N.Declaration | N.Mixin | N.Ruleset) || isStyleImportRegistrationNode(node);
  }

  private _storePreparedRegistrationNode(
    rules: Rules,
    node: Node,
    index: number,
    nodeIndex: number | undefined,
    prepState: RegistrationPrepState,
    context: Context
  ): void {
    rules.value[index] = node;
    node.index = nodeIndex;
    // After prep, check if it still has a static name.
    if (this._hasStaticName(node)) {
      const registrationContext = rules._scopeFrame?.liveSlotsByName.size
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
      const name = node.value.name;
      return this._isStatic(name);
    }
    if (isNode(node, N.Mixin)) {
      const name = node.value.name;
      return this._isStatic(name);
    }
    if (isNode(node, N.Declaration)) {
      const name = node.value.name;
      return this._isStatic(name);
    }
    if (isStyleImportRegistrationNode(node)) {
      const path = node.value.path;
      return this._isStatic(path);
    }
    if (isNode(node, N.Ruleset)) {
      const selector = node.value.selector;
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
    for (let i = 0; i < rules.value.length; i++) {
      const node = rules.value[i]!;
      const resolvedNode = resolvedByIndex.get(node.index);
      if (resolvedNode && resolvedNode !== node) {
        rules.value[i] = resolvedNode;
        rules.adopt(resolvedNode);
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
    const value = rules.value;
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
        rules.value[idx] = result;
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
          return isThenable(value)
            ? (value as Promise<Node>).catch(handleError)
            : value;
        } catch (error) {
          return handleError(error);
        }
      })();
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
        for (let idx = start; idx < rules.value.length; idx++) {
          const rule = rules.value[idx]!;
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

    const evaluateImports = evaluateLane(isStyleImportRegistrationNode, true);
    const evaluateBody = (): MaybePromise<boolean> => {
      const importDrain = drainPendingImports(false);
      const afterImports = () => {
        const calls = evaluateLane(rule => isNode(rule, N.Call), false);
        const afterCalls = () => {
          const normal = evaluateLane((rule) => {
            if (isNode(rule, N.VarDeclaration) || isStyleImportRegistrationNode(rule) || isNode(rule, N.Call)) {
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
    const getDeclValue = (decl: Node) => {
      if (!isNode(decl, N.Declaration)) {
        return undefined;
      }
      return decl.value;
    };
    const setDeclValue = (decl: Node, value: Node): void => {
      if (!isNode(decl, N.Declaration)) {
        return;
      }
      decl.value.value = value;
    };
    const copyMergedValue = (value: Node): Node => (
      canReuseLeaf(value)
        ? reuseLeaf(value)
        : copyWithReusableLeaves(value)
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
        if (isNode(node, N.List) || (assign === '&_:' && isNode(node, N.Sequence))) {
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
      if (assign === '&_:') {
        return spaced([copyMergedValue(priorValue), copyMergedValue(nextValue)]);
      }
      const priorItems = collectMergedItems(priorValue, assign);
      const nextItems = collectMergedItems(nextValue, assign);
      let nextStart = 0;
      if (priorItems.length > 0 && nextItems.length > 0) {
        const lastPrior = priorItems[priorItems.length - 1]!;
        const firstNext = nextItems[0]!;
        if (sameMergedItem(lastPrior, firstNext)) {
          nextStart = 1;
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
      return new List(mergedItems);
    };
    const composeMergedValue = (
      decl: Node,
      prior: Node,
      assign: string,
      priorAccumulatedValue?: Node
    ): Node | undefined => {
      if (!isNode(decl, N.Declaration) || !isNode(prior, N.Declaration)) {
        return undefined;
      }
      const nextDeclValue = getDeclValue(decl);
      if (!nextDeclValue) {
        return undefined;
      }
      const basePriorValue = priorAccumulatedValue
        ?? getDeclValue(prior)?.value;
      if (!basePriorValue) {
        return undefined;
      }
      if (startsWithMergedValue(nextDeclValue.value, basePriorValue, assign)) {
        return nextDeclValue.value;
      }
      const mergedValue = mergeDeclarationValues(basePriorValue, nextDeclValue.value, assign);
      setDeclValue(decl, mergedValue);
      normalizeMergedDeclarationValue(decl);
      const declImportant = decl.value.important;
      const priorImportant = prior.value.important;
      if (!declImportant && priorImportant) {
        decl.value.important = priorImportant;
      }
      const mergedDeclValue = getDeclValue(decl);
      return mergedDeclValue?.value;
    };
    const normalizeMergedDeclarationValue = (node: Node): void => {
      if (!isNode(node, N.Declaration)) {
        return;
      }
      const declValue = getDeclValue(node);
      if (!declValue) {
        return;
      }
      const current = declValue.value;
      if (!isNode(current, N.List) || current.value.length === 0) {
        return;
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
        return;
      }
      if (current.value.length === 1) {
        setDeclValue(node, new Nil());
        return;
      }
      if (current.value.length === 2) {
        setDeclValue(node, copyMergedValue(current.value[1]!));
        return;
      }
      const rest = new Array<Node>(current.value.length - 1);
      for (let i = 1; i < current.value.length; i++) {
        rest[i - 1] = copyMergedValue(current.value[i]!);
      }
      setDeclValue(node, new List(rest));
    };

    const lastVisibleByName = new Map<string, DeclOccurrence>();
    const mergedAnchorByName = new Map<string, DeclOccurrence>();
    const accumulatedValueByName = new Map<string, Node>();
    const processDeclarationOccurrence = (node: Node, ownerRules: Rules): void => {
      if (!isNode(node, N.Declaration)) {
        return;
      }
      const name = String(node.value.name);
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
      normalizeMergedDeclarationValue(node);
      let currentAccumulatedValue: Node | undefined;

      const prior = lastVisibleByName.get(name);
      const needsCrossScopeCompose = prior
        && prior.ownerRules !== ownerRules;
      if (prior && needsCrossScopeCompose) {
        currentAccumulatedValue = composeMergedValue(
          node,
          prior.node,
          assign,
          accumulatedValueByName.get(name)
        ) ?? currentAccumulatedValue;
      }
      const currentValue = getDeclValue(node)?.value;
      currentAccumulatedValue ??= currentValue;

      const existingAnchor = mergedAnchorByName.get(name);
      const occurrence = { node, ownerRules };
      if (existingAnchor && isNode(existingAnchor.node, N.Declaration)) {
        const anchorIsSameOccurrence = existingAnchor.node === node
          && existingAnchor.ownerRules === ownerRules;
        if (!anchorIsSameOccurrence) {
          if (existingAnchor.node === node && existingAnchor.ownerRules !== ownerRules) {
            existingAnchor.ownerRules.removeFlag(F_VISIBLE);
          } else {
            existingAnchor.node.removeFlag(F_VISIBLE);
          }
          mergedAnchorByName.set(name, occurrence);
          if (currentAccumulatedValue) {
            accumulatedValueByName.set(name, currentAccumulatedValue);
          }
          if (node.visible) {
            lastVisibleByName.set(name, occurrence);
          }
          return;
        }
      }

      mergedAnchorByName.set(name, occurrence);
      if (currentAccumulatedValue) {
        accumulatedValueByName.set(name, currentAccumulatedValue);
      }
      if (node.visible) {
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
      for (let i = 0; i < node.value.length; i++) {
        walkMergedDeclarations(node.value[i]!, node);
      }
    };

    for (const node of rules.value) {
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
    for (let i = 0; i < rules.value.length; i++) {
      if (isNode(rules.value[i]!, N.Ruleset | N.AtRule)) {
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
        || n.value.length === 0
      ) {
        return false;
      }
      for (let i = 0; i < n.value.length; i++) {
        if (!isNode(n.value[i]!, N.Declaration | N.Comment)) {
          return false;
        }
      }
      return true;
    };
    const moved: Node[] = [];
    const remainder: Node[] = [];
    for (let i = firstNestedIdx; i < rules.value.length; i++) {
      const node = rules.value[i]!;
      if (shouldMove(node)) {
        moved.push(node);
      } else {
        remainder.push(node);
      }
    }
    if (moved.length === 0) {
      return;
    }
    const reordered: Node[] = new Array(rules.value.length);
    let write = 0;
    for (let i = 0; i < firstNestedIdx; i++) {
      reordered[write++] = rules.value[i]!;
    }
    for (let i = 0; i < moved.length; i++) {
      reordered[write++] = moved[i]!;
    }
    for (let i = 0; i < remainder.length; i++) {
      reordered[write++] = remainder[i]!;
    }
    rules.value = reordered;
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

  private _checkReadonlyImportShadows(rules: Rules): void {
    // After all evaluation stages, direct variables in the current Rules cannot
    // shadow readonly variables imported into the same scope.
    if (rules.rulesSet.length === 0) {
      return;
    }
    const currentRegistry = rules.getRegistry('declaration');
    currentRegistry.indexPendingItems();
    for (const entry of rules.rulesSet) {
      if (!entry.readonly) {
        continue;
      }
      const importedRegistry = entry.node.getRegistry('declaration');
      importedRegistry.indexPendingItems();
      for (const [key, declarations] of importedRegistry.index) {
        for (const decl of declarations) {
          if (!isNode(decl, N.VarDeclaration)) {
            continue;
          }
          const currentDeclarations = currentRegistry.index.get(key);
          if (!currentDeclarations) {
            continue;
          }
          for (const currentDecl of currentDeclarations) {
            if (
              isNode(currentDecl, N.VarDeclaration)
              && !currentDecl.options?.setDefined
              && currentDecl.parent === rules
            ) {
              throw new ReferenceError(`"${key}" is readonly`);
            }
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

interface RulesEntry {
  node: Rules;
  rulesVisibility?: RulesOptions['rulesVisibility'];
  /**
   * These are from use, from, and import statements. Can't be assigned with $$
   * (verify that this is not possible with SCSS).
   */
  readonly?: boolean;
}

/**
 * Right now, the only nodes that can be registered to the scope for lookups
 */
// type ScopeNodes = Declaration | VarDeclaration | Mixin | Ruleset | Rules
function mixinHasNoRequiredParams(mixinNode: Mixin): boolean {
  const params = mixinNode.value.params;
  if (!params || params.length === 0) {
    return true;
  }
  for (const param of params.value) {
    if (param.type === 'Rest') {
      continue;
    }
    if (isNode(param, N.VarDeclaration)) {
      if (param.value.value instanceof Nil) {
        return false;
      }
      continue;
    }
    if (isNode(param, N.Any) && param.options.role === 'property') {
      return false;
    }
    return false;
  }
  return true;
}
