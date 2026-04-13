import {
  Node,
  defineType,
  type NodeOptions,
  type LocationInfo,
  type TreeContext,
  type RenderKey,
  F_STATIC,
  F_VISIBLE
} from './node.js';
import { Context } from '../context.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { comparePosition } from './util/compare.js';
import { cast } from './util/cast.js';
import { type Ruleset } from './ruleset.js';
import { type Mixin } from './mixin.js';
import type { Selector } from './selector.js';
import { spaced, Sequence } from './sequence.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';

import { atIndex } from './util/collections.js';
import type { Condition } from './condition.js';
import { Bool } from './bool.js';
import * as Registries from './util/registry-utils.js';
import { processExtends } from './util/extend-roots.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import { Nil } from './nil.js';
import { VarDeclaration } from './declaration-var.js';
import { Any } from './any.js';
import { List } from './list.js';
import { indent, normalizeIndent, serializeRulesContainerInline } from './util/serialize-helper.js';
import { freezeChildren } from './util/cloning.js';
import type { AtRule } from './at-rule.js';
import { type ScopeFrame, type BindingCell, buildScopeFrame } from './scope-frame.js';
const { isArray } = Array;

export const enum Priority {
  None = 0,
  Low = 1,
  Medium = 2,
  High = 3,
  Highest = 4
}
export type RulesVisibility = 'public' | 'optional' | 'private';

export interface RuntimeVarBinding {
  kind: 'runtime-var-binding';
  value: Node;
  readonly?: boolean;
  sourceNode?: Node;
}

type RuntimeVarBindingRecord = {
  name: string;
  value: Node;
  readonly?: boolean;
  sourceNode?: Node;
};

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
  /**
   * If true, this Rules node is output from a mixin call.
   * References with a target (e.g., #ns[@foo]) have public access to all nodes in these Rules.
   * References without a target (e.g., @foo) cannot access these Rules.
   */
  isMixinOutput?: boolean;
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

  rulesetRegistry: Registries.RulesetRegistry | undefined;
  mixinRegistry: Registries.MixinRegistry | undefined;
  declarationRegistry: Registries.DeclarationRegistry | undefined;
  functionRegistry: Registries.FunctionRegistry | undefined;
  /** Fast map: var name → ordered list of VarDeclarations registered in this scope. */
  varsByName: Map<string, VarDeclaration[]> | undefined;
  /**
   * Fast map: mixin start-key → ordered list of Mixin nodes with that plain name.
   * Only covers Mixin nodes whose name is a static (non-interpolated) Any node.
   * undefined means not yet indexed; an empty Map means indexed with no static mixins.
   * Ruleset-as-mixin candidates still go through the full MixinRegistry.
   */
  mixinsByName: Map<string, Mixin[]> | undefined;
  /**
   * Slice 6: ScopeFrame built alongside the existing registry.
   * undefined until first accessed via getScopeFrame().
   */
  scopeFrame: ScopeFrame | undefined;

  rulesIndexed = 0;
  _indexing = false;

  _indexRules() {
    if (this._indexing) {
      return; // Prevent recursive indexing
    }
    this._indexing = true;
    try {
      // Initialize fast maps so the hot-path can distinguish
      // "indexed (nothing found)" from "not yet indexed" (undefined).
      this.varsByName ??= new Map();
      this.mixinsByName ??= new Map();
      let value = this.value;
      let length = value.length;
      for (let i = this.rulesIndexed; i < length; i++) {
        const node = value[i]!;
        this.registerNode(node);
      }
      this.rulesIndexed = length;
    } finally {
      this._indexing = false;
    }
  }

  /**
   * Rules are often cloned during `preEval()` when `context.preserveOriginalNodes`
   * is enabled. If callers register functions/mixins/declarations on the parsed tree
   * before evaluation (e.g. via visitors), those registries must survive cloning so
   * lookups during evaluation work as expected.
   */
  override clone(deep?: boolean, cloneFn?: (n: Node) => Node): this {
    const newRules = super.clone(deep, cloneFn);

    // Only preserve *function* registry across clones.
    // This supports Less plugin compat, where plugins can inject functions into the registry
    // without creating AST nodes that would be re-registered on clone.
    //
    // Do NOT reuse declaration/mixin/ruleset registries across clones; those should always
    // be rebuilt from AST nodes via lazy indexing.
    if (this.functionRegistry) {
      newRules.functionRegistry = this.functionRegistry.cloneForRules(newRules);
    }

    // IMPORTANT: cloned Rules must re-index their own registries.
    // Otherwise, a clone can inherit `rulesIndexed` from the source Rules (often == value.length),
    // while having an empty/incorrect registry state, causing lookup misses (e.g. @c in detached-rulesets).
    newRules.rulesIndexed = 0;
    newRules._indexing = false;
    newRules._rulesSet = undefined;
    newRules.varsByName = undefined;
    newRules.mixinsByName = undefined;
    newRules.scopeFrame = undefined;

    return newRules;
  }

  /**
   * Lazily build and cache the ScopeFrame for this scope.
   * Requires _indexRules() to have run so varsByName is populated.
   *
   * Slice 6: frame is populated from varsByName (static-key VarDeclarations only).
   * Parent frame wiring is added in a later slice.
   */
  getScopeFrame(parent?: ScopeFrame): ScopeFrame {
    if (!this.scopeFrame) {
      this.scopeFrame = buildScopeFrame(this.varsByName, this, parent);
    }
    return this.scopeFrame;
  }

  /**
   * Lazily create registries for types as needed.
   */
  register(
    type: 'ruleset' | 'declaration' | 'mixin' | 'function',
    node: Node
  ) {
    let registry = this[`${type}Registry`];
    if (!registry) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      let className = `${type.charAt(0).toUpperCase()}${type.slice(1)}` as Capitalize<typeof type>;
      let RegistryClass = Registries[`${className}Registry`];
      registry = new RegistryClass(this);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (this as any)[`${type}Registry`] = registry;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const result = (registry as any).add(node);
    return result;
  }

  getRegistry(type: 'ruleset'): Registries.RulesetRegistry;
  getRegistry(type: 'declaration'): Registries.DeclarationRegistry;
  getRegistry(type: 'mixin'): Registries.MixinRegistry;
  getRegistry(type: 'function'): Registries.FunctionRegistry;
  getRegistry(type: 'ruleset' | 'declaration' | 'mixin' | 'function'): Registries.RulesetRegistry | Registries.DeclarationRegistry | Registries.MixinRegistry | Registries.FunctionRegistry;
  getRegistry(type: 'ruleset' | 'declaration' | 'mixin' | 'function') {
    let registry = this[`${type}Registry`];
    if (!registry) {
      /**
       * @note - Ideally we wouldn't create a registry object if we didn't have to,
       * just to find. But the find methods have complex logic for searching parent
       * and children rules / registries.
       */
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      let className = `${type.charAt(0).toUpperCase()}${type.slice(1)}` as Capitalize<typeof type>;
      let RegistryClass = Registries[`${className}Registry`];
      registry = new RegistryClass(this);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (this as any)[`${type}Registry`] = registry;
    }
    if (this.rulesIndexed < this.value.length) {
      this._indexRules();
    } else {
      // Even when no re-indexing is needed (empty or fully indexed), ensure
      // fast maps are defined so the hot-path can distinguish an indexed scope
      // from one that has never been accessed via getRegistry at all.
      this.varsByName ??= new Map();
      this.mixinsByName ??= new Map();
    }
    return registry;
  }

  /**
   * This wrapper is used so we don't prematurely create a registry
   * just to search it.
   */
  find(type: 'ruleset', keys: string | string[] | Set<string>, filterType?: string, options?: Registries.FindOptions): ReturnType<Registries.RulesetRegistry['find']> | undefined;
  find(type: 'declaration', keys: string, filterType?: string, options?: Registries.DeclarationFindOptions): ReturnType<Registries.DeclarationRegistry['find']> | undefined;
  find(type: 'mixin', keys: string | string[], filterType?: string, options?: Registries.FindOptions): ReturnType<Registries.MixinRegistry['find']> | undefined;
  find(type: 'function', keys: string, filterType?: string, options?: Registries.FindOptions): ReturnType<Registries.FunctionRegistry['find']> | undefined;
  find(type: 'ruleset' | 'declaration' | 'mixin' | 'function', key: string, filterType: string, options?: Registries.FindOptions): ReturnType<Registries.RulesetRegistry['find']> | ReturnType<Registries.DeclarationRegistry['find']> | ReturnType<Registries.MixinRegistry['find']> | ReturnType<Registries.FunctionRegistry['find']> | undefined;
  find(
    type: 'ruleset' | 'declaration' | 'mixin' | 'function',
    keys: string | string[] | Set<string>,
    filterType?: string,
    options: Registries.FindOptions = {}
  ): ReturnType<Registries.RulesetRegistry['find']> | ReturnType<Registries.DeclarationRegistry['find']> | ReturnType<Registries.MixinRegistry['find']> | ReturnType<Registries.FunctionRegistry['find']> | undefined {
    let registry = this.getRegistry(type);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return (registry as any).find(keys, filterType, options);
  }

  override toString(options?: PrintOptions): string {
    if (!this.visible && !this.fullRender) {
      return '';
    }
    options = getPrintOptions(options);
    const w = options.writer!;
    const depth = options.depth!;
    const mark = w.mark();
    const previousReferenceMode = options.referenceMode === true;
    const previousReferenceRenderEnabled = options.referenceRenderEnabled !== false;
    const ownReferenceMode = (this.options as { referenceMode?: boolean } | undefined)?.referenceMode === true;
    if (ownReferenceMode && !previousReferenceMode) {
      options.referenceMode = true;
      options.referenceRenderEnabled = false;
    }

    const ctx = options.context;
    const suppressedLeadingComments: Array<{ node: Node; visible: boolean }> = [];
    if (depth === 0) {
      // Snapshot global emit-tracking so repeated `.toString()` calls remain stable.
      const prevCharsetEmitted = ctx?.charsetEmitted;
      const prevTopImports = ctx?.topImports ? [...ctx.topImports] : undefined;
      // @charset must be first
      if (ctx?.currentCharset && !ctx.charsetEmitted) {
        const charset = ctx.currentCharset;
        // Use capture to avoid double-writing (toTrimmedString writes to writer AND returns the string)
        const charsetStr = w.capture(() => charset.toTrimmedString(options));
        w.add(charsetStr, charset);
        w.add('\n');
        // Do not permanently flip `charsetEmitted` here; restore at end.
        ctx.charsetEmitted = true;
      }
      // Less keeps leading comments before hoisted @import output.
      const isCommentLike = (node: Node): boolean => {
        const text = String(node.valueOf?.() ?? '').trimStart();
        if (!text.startsWith('/*')) {
          return false;
        }
        return isNode(node, N.Comment) || isNode(node, N.Any);
      };
      if (ctx?.topImports?.length) {
        for (const node of this.value) {
          if (!isCommentLike(node)) {
            break;
          }
          const commentStr = w.capture(() => node.toTrimmedString(options));
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
          const importStr = w.capture(() => importRule.toString(options));
          w.add(normalizeIndent(importStr, ''), importRule);
          w.add('\n');
        }
        // Do not permanently clear; restore at end.
      }
      // Restore global tracking (we only needed it during this print).
      if (ctx) {
        ctx.charsetEmitted = prevCharsetEmitted;
        if (prevTopImports) {
          ctx.topImports = prevTopImports;
        }
      }
    }

    this.processPrePost('pre', '', options);
    const bodyMark = w.mark();
    const bodyStr = this.toTrimmedString(options);
    const bodyEmitted = w.getSince(bodyMark);
    if (bodyEmitted.length === 0 && bodyStr) {
      w.add(bodyStr);
    }
    // At root level, ensure output ends with a single newline (standard for CSS files)
    // Don't propagate all the last child's post content (which may have extra whitespace)
    if (depth === 0) {
      for (const suppressed of suppressedLeadingComments) {
        if (suppressed.visible) {
          suppressed.node.addFlag(F_VISIBLE);
        }
      }
      const result = w.getSince(mark).trimEnd();
      options.referenceMode = previousReferenceMode;
      options.referenceRenderEnabled = previousReferenceRenderEnabled;
      // Ensure exactly one trailing newline (only if there's content)
      return result ? result + '\n' : '';
    }
    options.referenceMode = previousReferenceMode;
    options.referenceRenderEnabled = previousReferenceRenderEnabled;
    return w.getSince(mark);
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
    super(value ?? [], mergedOptions, location, treeContext);
  }

  * [Symbol.iterator]() {
    let value = this.value;
    /**
     * This should always be the case? But at one point something somewhere
     * set the value to undefined I think, so just leaving this defensively.
     */
    if (isArray(value)) {
      yield* value.entries();
    }
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
    // Set depth for _emitRulesBody - children should be one level deeper
    const childOptions = { ...opts, depth: depth + 1 };
    childOptions.writer!.add('\n');
    this._emitRulesBody(childOptions);
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

  private _emitRulesBody(options: PrintOptions) {
    const w = options.writer!;
    const depth = options.depth ?? 0;
    const space = indent(depth);
    const { value } = this;
    const lastRenderedFrames = options.lastRenderedFrames!;
    const frameHeaders = options.frameHeaders!;
    const renderedFrameBaseline = lastRenderedFrames.length;
    if (this._renderKey !== undefined) {
      options.renderKey = this._renderKey;
    }
    // Propagate this Rules wrapper's own `referenceMode` into PrintOptions
    // before emitting children. Without this, import wrappers (shallow-cloned
    // from a shared evaluated tree) can't hide their content via reference
    // mode — the flag lives on the wrapper's options but never reaches
    // downstream serialize-helper checks for descendants pulled up by
    // `flatRules` (which strips the nested Rules boundary).
    if ((this.options as { referenceMode?: boolean } | undefined)?.referenceMode === true
      && options.referenceMode !== true) {
      options.referenceMode = true;
    }
    const referenceMode = Boolean(options.referenceMode);
    const referenceRenderEnabled = referenceMode ? Boolean(options.referenceRenderEnabled) : true;

    // Skip charset nodes - they are collected and prepended at root level
    // Nil nodes are now non-visible, so they're automatically filtered by n.visible
    const items = value.filter(n => n.visible);

    if (items.length === 0) {
      return;
    }

    // No spacing flags; writer.capture is used where needed

    const isInlineSourceRules = (node: Node): boolean => {
      if (node.type !== 'Rules') {
        return false;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const rulesNode = node as Rules;
      if (rulesNode.value.length !== 1) {
        return false;
      }
      const only = rulesNode.value[0]!;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return only.type === 'Any' && (only.options as any)?.role === 'any';
    };

    let emittedCount = 0;
    let lastEmittedType: string | undefined;
    let lastEmittedWasInlineSourceRules = false;
    const emitBoundaryIfNeeded = (n: Node) => {
      if (emittedCount === 0) {
        return;
      }
      const currentBuffer = w.getSince(0);
      const bufferEndsWithNewline = currentBuffer.endsWith('\n');
      const needsInlineBoundarySpacing = (
        (lastEmittedType === 'Any' && n.type !== 'Any')
        || (lastEmittedWasInlineSourceRules && n.type !== 'Any')
      );
      if (!bufferEndsWithNewline || needsInlineBoundarySpacing) {
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
    for (let idx = 0; idx < items.length; idx++) {
      const n = items[idx]!;
      const isContainer = n.type === 'Ruleset' || n.type === 'AtRule' || n.type === 'Rules';
      if (referenceMode && !referenceRenderEnabled && !isContainer) {
        continue;
      }
      const isChildRules = n.type === 'Rules';
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const isLeafAtRule = n.type === 'AtRule' && !(n as AtRule).value.rules;
      const isRulesetOrAtRule = n.type === 'Ruleset' || (n.type === 'AtRule' && !isLeafAtRule);
      // Add indentation only for simple nodes (declarations, etc.)
      // Ruleset and AtRule nodes indent themselves in renderOpening
      // Emit directly to preserve source map segments
      // For child Rules nodes, pass the same depth (don't increment depth)
      // Rules nodes inside Rules nodes are at the same level
      let childOptions = {
        ...options,
        depth,
        referenceMode,
        referenceRenderEnabled
      };
      if (isChildRules) {
        const ownReferenceMode = (
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          (n.options as any)?.referenceMode === true
        );
        const childReferenceMode = referenceMode || ownReferenceMode;
        const enteringReferenceMode = !referenceMode && ownReferenceMode;
        const childReferenceRenderEnabled = childReferenceMode
          ? (enteringReferenceMode ? false : referenceRenderEnabled)
          : true;
        childOptions = {
          ...childOptions,
          referenceMode: childReferenceMode,
          referenceRenderEnabled: childReferenceRenderEnabled
        };
      }
      if (isRulesetOrAtRule) {
        emitBoundaryIfNeeded(n);
        const mark = w.mark();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const rule = serializeRulesContainerInline(n as Ruleset | AtRule, getPrintOptions(childOptions));
        const emitted = w.getSince(mark);
        if (!emitted && !rule) {
          continue;
        }
        if (!emitted && rule) {
          w.add(rule, n);
        }
        markEmitted(n);
        continue;
      }
      closeRenderedFramesToBaseline();
      let rule = w.capture(() => n.toTrimmedString(childOptions));
      if (!rule && (n.type === 'Ruleset' || n.type === 'AtRule' || n.type === 'Rules')) {
        continue;
      }
      const prefix = !isChildRules && !isRulesetOrAtRule && depth !== 0 ? space : undefined;
      emitCaptured(rule, n, prefix);
    }
    while (lastRenderedFrames.length > renderedFrameBaseline) {
      const depthToClose = lastRenderedFrames.length - 1;
      w.add(indent(depthToClose) + '}\n');
      lastRenderedFrames.pop();
      frameHeaders.pop();
    }
  }

  override toTrimmedString(options?: PrintOptions) {
    if (!this.visible && !this.fullRender) {
      return '';
    }
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    this._emitRulesBody(options);
    return w.getSince(mark);
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

  /**
   * Same traversal as `flatRules`, but also returns the `_renderKey` of the
   * nearest enclosing Rules (including `this`) for each leaf. Used by
   * serialization to propagate per-call forks into shared leaf nodes adopted
   * into multiple per-renderKey wrapper Rules (mixin calls, $for iterations).
   *
   * Returning a parallel `renderKeys` array instead of wrapping each entry
   * keeps the happy path (`flatRules()` → `Node[]`) unchanged for its many
   * other callers.
   */
  flatRulesWithKeys(visibleOnly: boolean = false): {
    nodes: Node[];
    renderKeys: Array<RenderKey | undefined>;
  } {
    const nodes: Node[] = [];
    const renderKeys: Array<RenderKey | undefined> = [];
    const iterateRules = (rules: Rules, inheritedKey: RenderKey | undefined) => {
      const effectiveKey = rules._renderKey ?? inheritedKey;
      for (let n of rules.value) {
        if (isNode(n, N.Rules)) {
          if (visibleOnly && !n.visible && !n.fullRender) {
            continue;
          }
          if ((n.options as { referenceMode?: boolean } | undefined)?.referenceMode === true) {
            if (!visibleOnly || n.visible || n.fullRender) {
              nodes.push(n);
              renderKeys.push(effectiveKey);
            }
            continue;
          }
          iterateRules(n as Rules, effectiveKey);
          continue;
        }
        if (!visibleOnly || n.visible || n.fullRender) {
          nodes.push(n);
          renderKeys.push(effectiveKey);
        }
      }
    };
    iterateRules(this, this._renderKey);
    return { nodes, renderKeys };
  }

  visibleRules() {
    return this.value.filter(n => n.visible);
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    iterateRules(this as unknown as Rules);
    return Object.fromEntries(output);
  }

  /** @todo - Refactor? */
  _rulesSet: RulesEntry[] | undefined;
  get rulesSet(): RulesEntry[] {
    return (this._rulesSet ??= []);
  }

  registerNode(node: Node, options?: Record<string, any>, _context?: Context) {
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
      this.rulesSet.push({
        node,
        rulesVisibility,
        readonly
      });

      // Note: Rulesets from imported Rules are registered in treeRoot's registry
      // after evaluation completes (in evalNode), when treeRoot is guaranteed to be set
    } else if (isNode(node, N.Declaration)) {
      /**
       * setDefined works like Sass's !default flag - it finds the original variable
       * declaration and inserts a new declaration at the same rules level as the
       * found variable, but before the current nested node.
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        let result = this.find('declaration', key, node.type as 'VarDeclaration' | 'Declaration', opts);
        if (result) {
          if (result.options?.readonly || opts.readonly) {
            throw new ReferenceError(`"${key}" is readonly`);
          }

          // Find the Rules node that contains the found declaration
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          let foundRules: Rules | undefined = result.parent as Rules;

          if (!foundRules) {
            throw new Error(`Could not find parent Rules for declaration '${key}'`);
          }

          // Create a new declaration with the same name but our value
          const newDeclaration = node.copy();
          newDeclaration.options = { ...newDeclaration.options };
          newDeclaration.options.setDefined = undefined; // Remove setDefined flag

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

          // Register it via registerNode to ensure it's properly indexed
          // Note: registerNode will call register('declaration', ...) which adds to registry
          // We skip setDefined processing since we already removed the flag
          foundRules.registerNode(newDeclaration);
        } else {
          throw new ReferenceError(`"${key}" is not defined`);
        }
      }

      this.register('declaration', node);
      if (isNode(node, N.VarDeclaration)) {
        const name = (node as VarDeclaration).value.name.valueOf();
        const map = (this.varsByName ??= new Map());
        let arr = map.get(name);
        if (!arr) {
          map.set(name, arr = []);
        }
        arr.push(node as VarDeclaration);
      }
    } else if (isNode(node, N.Ruleset)) {
      // Register to 'mixin' for mixin calls
      // Always register - guard filtering happens at call time in getFunctionFromMixins
      // Note: 'ruleset' registration for extends now happens in Ruleset.preEval to the extend root's registry
      this.register('mixin', node);
    } else if (isNode(node, N.Mixin)) {
      this.register('mixin', node);
      // Fast map: only static (non-interpolated) names get an O(1) entry.
      // Interpolated mixin names fall through to the full MixinRegistry.
      // Guard: skip when called from _indexRules (_indexing=true) — those nodes were
      // already added during _multiPassPreEval and we must not double-count.
      if (!this._indexing) {
        const mixinName = (node as Mixin).value.name;
        if (mixinName && mixinName.type !== 'Interpolated') {
          const key = mixinName.valueOf() as string;
          const mm = (this.mixinsByName ??= new Map());
          let arr = mm.get(key);
          if (!arr) {
            mm.set(key, arr = []);
          }
          arr.push(node as Mixin);
        }
      }
    } else if (isNode(node, N.Func)) {
      this.register('function', node);
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
    return atIndex(this.value, index);
  }

  /**
   * This traverses deeply to visit all nodes, but indexes locally.
   */
  override preEval(context: Context) {
    if (!this.preEvaluated) {
      context.depth++;
      let rules = this.maybeClone(context);
      // When this is the nestable at-rule wrapper (one child Ruleset(&)), do not clone so
      // inner rulesets register to the same object we push and register as extend root.
      const nestableAtRuleNames = new Set(['@media', '@supports', '@layer', '@container', '@scope']);
      const parentAtRule = this.parent?.type === 'AtRule' ? this.parent : null;
      const isNestableAtRuleBody =
        parentAtRule
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        && nestableAtRuleNames.has(String((parentAtRule as { value?: { name?: { valueOf?(): string } } }).value?.name?.valueOf?.() ?? ''));
      const first = rules.value?.[0];
      const isWrapper =
        isNestableAtRuleBody
        && rules.value?.length === 1
        && isNode(first, N.Ruleset)
        && isNode((first as Ruleset).value?.selector, N.Ampersand);
      if (isWrapper) {
        rules = this;
      }
      rules.preEvaluated = true;
      // Save current context and set up new context for variable lookups during preEval
      const saved = this._snapshotContext(context);
      this._setupContextForRules(context, rules);

      // Set context.root early if this is the main root
      const isMainRoot = !context.root;
      if (isMainRoot) {
        context.root = rules;
      }

      /**
       * I think maybe we can just set the index to the actual order?
       */
      for (let i = 0; i < rules.value.length; i++) {
        let n = rules.value[i]!;
        n.index = i;
      }
      // Preserve parent when cloning - if this Rules is inside a ruleset, maintain the parent relationship
      if (this.parent && !rules.parent) {
        this.parent.adopt(rules);
      }

      // Set context.root if not already set (needed for preEval visitors)
      if (!context.root) {
        context.root = rules;
      }
      // When getTree() set context.root to the original Rules but we're processing a clone,
      // use the clone as context.root so registerRoot/pushExtendRoot run and rulesets register to the clone (extend fix).
      if (context.root === this && this !== rules) {
        context.root = rules;
      }

      // Register main root as extend root if this is the root (needed for extends in preEval)
      // Check rules === context.root at registration time (not using stale isMainRoot)
      if (rules === context.root && !context.extendRoots.root) {
        context.extendRoots.registerRoot(rules);
        context.extendRoots.pushExtendRoot(rules);
      }

      // Always push nestable at-rule body so inner rulesets register to it (not document root).
      // Needed for both: wrapper (collapseNesting) and direct body (collapseNesting: false).
      if (isNestableAtRuleBody) {
        context.extendRoots.pushExtendRoot(rules);
      }

      // Multi-pass registration system for handling interpolated names
      const mp = this._multiPassPreEval(rules, context, saved);
      const popNestableBody = () => {
        if (isNestableAtRuleBody) {
          context.extendRoots.popExtendRoot();
        }
      };
      if (isThenable(mp)) {
        return (mp as Promise<this>).then((result) => {
          popNestableBody();
          return result;
        });
      }
      popNestableBody();
      return mp;
    }
    return this;
  }

  /**
   * Multi-pass preEval system to handle interpolated names and dependencies
   */
  private _multiPassPreEval(rules: Rules, context: Context, saved: any): MaybePromise<this> {
    // First pass: Only register nodes with static names
    const staticNodes: Node[] = [];
    const dynamicNodes: Node[] = [];

    // Process each node with static name, handling both sync and async preEval
    const processResult = serialForEach(rules.value, (node, index) => {
      if (node.type === 'Any' && node.options.role === 'charset') {
        /** Special case where we register the charset node immediately */
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        rules.value[index] = (node as Any).preEval(context);
        return;
      }
      // Nodes that don't register by name (Call, Expression, etc.) skip
      // both preEval and dynamic resolution — they're handled by the eval queue.
      if (!this._isRegisterableType(node)) {
        node.index = index;
        return;
      }
      if (this._hasStaticName(node)) {
        // Pre-evaluate nodes with static names before registration
        // This ensures selectors are evaluated and keySets are available for rulesets
        const preEvald = node.preEval(context);
        if (isThenable(preEvald)) {
          return (preEvald as Promise<Node>).then((preEvaldNode) => {
            rules.value[index] = preEvaldNode;
            (preEvaldNode as Node).index = index;
            // After async preEval, check if it still has a static name
            if (this._hasStaticName(preEvaldNode)) {
              staticNodes.push(preEvaldNode);
              this._registerNodeIfEligible(rules, preEvaldNode, context);
            } else {
              dynamicNodes.push(preEvaldNode);
            }
          });
        }
        rules.value[index] = preEvald as Node;
        (preEvald as Node).index = index;
        const nodeToRegister = preEvald as Node;
        staticNodes.push(nodeToRegister);
        this._registerNodeIfEligible(rules, nodeToRegister, context);
      } else {
        dynamicNodes.push(node);
      }
    });

    const finish = () => {
      // Stamp fast maps so the hot-path (findVarDeclarationFast / findMixinFast) can distinguish
      // "preEval completed with nothing registerable" from "scope never processed at all".
      rules.varsByName ??= new Map();
      rules.mixinsByName ??= new Map();
      // If no dynamic nodes, we're done
      if (dynamicNodes.length === 0) {
        // Restore context after preEval is complete
        context.rulesContext = saved.rulesContext;
        context.treeRoot = saved.treeRoot;
        // Only restore context.root if saved.root is defined (not the outermost root)
        // If saved.root is undefined, it means we're at the outermost level, so keep context.root as is
        if (saved.root !== undefined) {
          context.root = saved.root;
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        return rules as this;
      }
      // Multi-pass resolution of dynamic nodes
      return this._resolveDynamicNodes(rules, context, saved, dynamicNodes);
    };

    if (isThenable(processResult)) {
      return (processResult as Promise<void>).then(() => finish());
    }
    return finish();
  }

  /**
   * Helper to check if a value is static (either a Node with F_STATIC flag or a primitive value)
   */
  private _isStatic(value: any): boolean {
    if (value && typeof value.hasFlag === 'function') {
      return value.hasFlag(F_STATIC);
    }
    // Primitive values (strings, numbers, etc.) are considered static
    return true;
  }

  /**
   * Check if a node type participates in name-based registration.
   * Only these node types have names/selectors that _resolveDynamicNodes
   * needs to resolve. Everything else (Call, Expression, Comment, etc.)
   * goes straight to the eval queue without preEval.
   */
  private _isRegisterableType(node: Node): boolean {
    return isNode(node, N.VarDeclaration | N.Declaration | N.Mixin | N.Ruleset) || (node as Node).type === 'StyleImport';
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
    if (node.type === 'StyleImport') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const path = (node as any).value.path;
      return this._isStatic(path);
    }
    if (isNode(node, N.Ruleset)) {
      const selector = node.value.selector;
      // BasicSelector, CompoundSelector, ComplexSelector etc. are always static
      // Only Interpolated selectors need resolution
      if (isNode(selector, N.BasicSelector | N.CompoundSelector | N.ComplexSelector | N.SelectorList)) {
        return true;
      }
      // After preEval, the selector should be resolved to static identifiers
      if (node.preEvaluated) {
        return true;
      }
      // Check F_STATIC flag for other selector types
      if (selector && 'hasFlag' in (selector as Node) && typeof (selector as Node).hasFlag === 'function') {
        return (selector as Node).hasFlag(F_STATIC);
      }
      return false;
    }
    // For other registerable node types, check the F_STATIC flag
    return node.hasFlag(F_STATIC);
  }

  /**
   * Register a node if it's eligible for registration
   */
  private _registerNodeIfEligible(rules: Rules, node: Node, _context: Context) {
    if (isNode(node, N.Declaration)) {
      rules.registerNode(node);
    } else if (isNode(node, N.Mixin)) {
      rules.registerNode(node);
    } else if (isNode(node, N.Ruleset)) {
      // registerNode handles both 'mixin' and 'ruleset' registries
      rules.registerNode(node);
    }
  }

  /**
   * Multi-pass resolution of dynamic nodes with interpolated names
   */
  private _resolveDynamicNodes(rules: Rules, context: Context, saved: any, dynamicNodes: Node[]): MaybePromise<this> {
    const resolvedNodes: Node[] = [];

    const handleResolvedNode = (resolvedNode: Node, node: Node, stillUnresolved: Node[]): boolean => {
      if (resolvedNode.index === undefined) {
        resolvedNode.index = node.index;
      }
      if (!resolvedNode.sourceNode) {
        resolvedNode.sourceNode = node.sourceNode ?? node;
      }
      if (resolvedNode.type === 'Ruleset') {
        rules.registerNode(resolvedNode);
      }
      if (isNode(resolvedNode, N.Nil) || this._hasStaticName(resolvedNode)) {
        resolvedNodes.push(resolvedNode);
        this._registerNodeIfEligible(rules, resolvedNode, context);
        return true; // made progress
      } else {
        stillUnresolved.push(resolvedNode);
        return false;
      }
    };

    const applyResolvedNodes = () => {
      for (let i = 0; i < rules.value.length; i++) {
        const node = rules.value[i]!;
        const resolvedNode = resolvedNodes.find(n => n.index === node.index);
        if (resolvedNode && resolvedNode !== node) {
          rules.value[i] = resolvedNode.inherit(node);
          rules.adopt(resolvedNode);
        }
      }
    };

    const finishResolution = (): this => {
      applyResolvedNodes();
      context.rulesContext = saved.rulesContext;
      context.treeRoot = saved.treeRoot;
      if (saved.root !== undefined) {
        context.root = saved.root;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return rules as this;
    };

    // Separate declarations (whose dynamic names might depend on each other)
    // from non-declarations (which depend on declaration VALUES, not names,
    // so retrying during preEval won't help).
    const isDeclarationType = (n: Node) =>
      isNode(n, N.VarDeclaration) || isNode(n, N.Declaration);

    const dynamicDeclarations: Node[] = [];
    const otherDynamic: Node[] = [];
    for (const node of dynamicNodes) {
      if (isDeclarationType(node)) {
        dynamicDeclarations.push(node);
      } else {
        otherDynamic.push(node);
      }
    }

    // Phase 1: Resolve declarations with dynamic names.
    // Retry because one declaration's name might depend on another's being registered.
    const MAX_DECL_RETRIES = 5;
    let declRetries = 0;
    const unresolvedDecls: Node[] = [...dynamicDeclarations];

    const resolveDeclarations = (): MaybePromise<void> => {
      declRetries++;
      if (declRetries > MAX_DECL_RETRIES || unresolvedDecls.length === 0) {
        return;
      }
      const stillUnresolved: Node[] = [];
      let madeProgress = false;

      for (let i = 0; i < unresolvedDecls.length; i++) {
        const node = unresolvedDecls[i]!;
        try {
          const result = node.preEval(context);

          if (isThenable(result)) {
            const remaining = unresolvedDecls.slice(i + 1);
            return (result as Promise<Node>).then((resolvedNode) => {
              if (handleResolvedNode(resolvedNode, node, stillUnresolved)) {
                madeProgress = true;
              }
              unresolvedDecls.length = 0;
              unresolvedDecls.push(...stillUnresolved, ...remaining);
              if (madeProgress && unresolvedDecls.length > 0) {
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
        unresolvedDecls.length = 0;
        unresolvedDecls.push(...stillUnresolved);
        return resolveDeclarations();
      }
    };

    // Phase 2: Try non-declarations once. Their interpolated names typically
    // depend on declaration VALUES (e.g. @infix from breakpoint-infix()),
    // which aren't evaluated until the eval phase. Retrying won't help.
    const resolveOtherOnce = (): MaybePromise<void> => {
      for (let i = 0; i < otherDynamic.length; i++) {
        const node = otherDynamic[i]!;
        try {
          const result = node.preEval(context);

          if (isThenable(result)) {
            const remaining = otherDynamic.slice(i + 1);
            return (result as Promise<Node>).then((resolvedNode) => {
              handleResolvedNode(resolvedNode, node, []);
              // Continue with remaining nodes
              otherDynamic.length = 0;
              otherDynamic.push(...remaining);
              return resolveOtherOnce();
            });
          }

          handleResolvedNode(result as Node, node, []);
        } catch {
          // Can't resolve during preEval — leave in place for eval phase
        }
      }
    };

    return pipe(
      () => resolveDeclarations(),
      () => {
        applyResolvedNodes();
        return resolveOtherOnce();
      },
      () => finishResolution()
    );
  }

  /**
   * Helper method to continue preEval'ing remaining children after an async preEval.
   */
  private _preEvalRemainingChildren(rules: Rules, context: Context, startIndex: number, saved?: any): MaybePromise<this> {
    for (let i = startIndex; i < rules.value.length; i++) {
      const node = rules.value[i]!;

      // Always call preEval to ensure deep traversal and name resolution
      const result = node.preEval(context);
      if (isThenable(result)) {
        // Handle async preEval by returning a promise that resolves after all children
        return result.then((resolvedNode) => {
          // Update the node if preEval returned a different instance
          if (resolvedNode !== node) {
            rules.value[i] = resolvedNode;
            rules.adopt(resolvedNode);
          }

          // Register the node after preEval (name resolution) if not already registered
          if (!isNode(node, N.VarDeclaration)) {
            rules.registerNode(resolvedNode);
          }

          // Continue with the rest of the children
          return this._preEvalRemainingChildren(rules, context, i + 1, saved);
        });
      }

      // Update the node if preEval returned a different instance
      if (result !== node) {
        rules.value[i] = result;
        rules.adopt(result);
      }

      // Register the node after preEval (name resolution) if not already registered
      if (!isNode(node, N.VarDeclaration)) {
        rules.registerNode(result);
      }
    }

    // Restore context after preEval is complete (for async case)
    if (saved) {
      context.rulesContext = saved.rulesContext;
      context.treeRoot = saved.treeRoot;
      // Only restore context.root if saved.root is defined (not the outermost root)
      // If saved.root is undefined, it means we're at the outermost level, so keep context.root as is
      if (saved.root !== undefined) {
        context.root = saved.root;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return rules as this;
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

  /** Setup context for evaluating these rules */
  private _setupContextForRules(context: Context, rules: Rules) {
    const treeContext = context.treeContext;
    // Only switch treeContext if the rules have one AND it's different
    // Dynamically created Rules (e.g., mixin parameter wrappers) may not have treeContext
    // and we don't want to lose leakyRules and other settings
    // IMPORTANT: Check _treeContext (private field) not treeContext (getter that lazily creates)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const rulesTreeContext = (rules as any)._treeContext as TreeContext | undefined;
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
        map.set(node as Ruleset, counter.value);
        counter.value++;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const innerRules = (node as Node & { value?: { rules?: unknown } }).value?.rules;
      if (innerRules && isNode(innerRules, N.Rules)) {
        this._assignDocumentOrderDepthFirst(innerRules as Rules, map, counter);
      }
    }
  }

  /** Build the evaluation queue partitioned by priority */
  private _buildEvalQueue(rules: Rules): EvalQueueMap {
    let evalQueue: EvalQueueMap = new Map();
    for (let item of rules) {
      let [, rule] = item;
      let priority = NodeTypeToPriority.get(rule.type) ?? Priority.None;
      // Less variable-calls `@foo();` are parsed as Expression(Call(variable-ref)).
      // We *selectively* boost only those calls that "unlock mixins" (i.e. calling a variable whose
      // value is a detached ruleset containing mixin definitions). This avoids changing evaluation
      // order for regular detached rulesets like `@ruleset()` used for property blocks.
      if (priority === Priority.None && rules.treeContext?.leakyRules === true && isNode(rule, N.Expression)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const inner = (rule as any).value;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        if (isNode(inner, N.Call) && isNode((inner as any).value?.name, N.Reference)) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const ref = (inner as any).value.name;
          const refType = String(ref?.options?.type ?? '');
          if (refType === 'variable') {
            const raw = ref.value?.key;
            const keyStr = Array.isArray(raw) ? raw.join('') : String(raw?.valueOf?.() ?? raw ?? '');
            // Only if variable exists and its value is a detached ruleset Mixin with nested Mixin definitions.
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            const decl = rules.find('declaration', keyStr, 'VarDeclaration') as any;
            const val = decl?.value?.value;
            const hasNestedMixinDefinitions =
              isNode(val, N.Mixin)
              && Array.isArray(val.value?.rules?.value)
              && val.value.rules.value.some((n: any) => n?.type === 'Mixin');
            if (hasNestedMixinDefinitions) {
              priority = Priority.High;
            }
          }
        }
      }
      let queue = evalQueue.get(priority) ?? [];
      queue.push(item as [number, Node]);
      evalQueue.set(priority, queue);
    }
    return evalQueue;
  }

  /** Evaluate the built queues in priority order */
  private _evaluateQueue(rules: Rules, evalQueue: EvalQueueMap, context: Context): MaybePromise<boolean> {
    let rulesToHoist = false;
    const scheduledPriority = new WeakMap<Node, Priority>();
    const failuresByPriority = new WeakMap<Node, Map<Priority, number>>();

    const priorities: Priority[] = Array.from({ length: Priority.Highest + 1 }).map((_, i) => (Priority.Highest - i) as Priority);
    const runPriority = (p: Priority): MaybePromise<void> => {
      const queue = evalQueue.get(p);
      if (!queue) {
        return;
      }
      const enqueueRetry = (priority: Priority, item: [number, Node], rule: Node): void => {
        const retryQueue = evalQueue.get(priority) ?? [];
        retryQueue.push(item);
        evalQueue.set(priority, retryQueue);
        scheduledPriority.set(rule, priority);
      };
      const countFailure = (rule: Node, priority: Priority): number => {
        const byPriority = failuresByPriority.get(rule) ?? new Map<Priority, number>();
        const nextCount = (byPriority.get(priority) ?? 0) + 1;
        byPriority.set(priority, nextCount);
        failuresByPriority.set(rule, byPriority);
        return nextCount;
      };
      const runSingleEntry = (q: number): MaybePromise<void | undefined> => {
        const [idx, rule] = queue[q]!;
        /**
         * Var declarations have late evaluation, so they are skipped.
         * (Meaning: they are not evaluated until they are referenced.)
         */
        if (isNode(rule, N.VarDeclaration)) {
          return;
        }

        // Skip stale entries for nodes that were re-queued to a different priority.
        const expectedPriority = scheduledPriority.get(rule);
        if (expectedPriority !== undefined && expectedPriority !== p) {
          return;
        }

        const onEvalError = (error: unknown): Node | undefined => {
          // Most node failures are semantic failures and should throw immediately.
          // Retry scheduling is reserved for StyleImport ordering/interpolation cases.
          if (rule.type !== 'StyleImport') {
            throw error;
          }
          // Final pass: no retries remain.
          if (p === Priority.None) {
            throw error;
          }

          // Only retry when the import path itself couldn't be resolved
          // (e.g. @import "@{theme}/file" where @theme isn't available yet).
          // Path resolution is cheap (no cloning). Content evaluation errors
          // (after cloning the import tree) are never retried — each retry
          // would re-clone the entire tree, causing memory blowup.
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const isPathError = error instanceof Error && (error as any)._isPathResolutionError;
          if (!isPathError) {
            throw error;
          }

          // Retry policy:
          // 1) first failure at a priority -> retry once at same priority
          // 2) second+ failure at that priority -> step down one level
          const failures = countFailure(rule, p);
          const nextPriority = failures === 1 ? p : (p - 1) as Priority;
          enqueueRetry(nextPriority, [idx, rule], rule);
          return;
        };
        const tryStepResult = (): MaybePromise<Node | undefined> => {
          try {
            const result = rule.eval(context);
            if (isThenable(result)) {
              return (result as Promise<Node>).catch(onEvalError);
            }
            return result as Node;
          } catch (error) {
            return onEvalError(error);
          }
        };
        const stepResult = pipe(
          tryStepResult,
          (result: Node | undefined) => {
            // Undefined means we re-queued this node for retry.
            if (result === undefined) {
              return;
            }
            scheduledPriority.delete(rule);
            // Apply the result
            if (result !== rule) {
              rules.value[idx] = result;
              queue[q] = [idx, result];
              // If a StyleImport evaluated to Rules, register them in the parent's _rulesSet
              // so variables from the import can be found by the parent
              // Also register Rules from Call results (mixin calls) in the same way
              if (isNode(result, N.Rules)) {
                // Set the index of the imported Rules to the StyleImport's index
                // so we can compare Rules indices when determining which variable was declared later
                result.index = idx;
                rules.adopt(result);
                rules.registerNode(result, {
                  rulesVisibility: result.options.rulesVisibility,
                  readonly: result.options.readonly
                }, context);
              } else {
                // For non-Rules results, adopt them to set up parent chain
                rules.adopt(result);
              }
            }
            if (result.hoistToRoot) {
              rulesToHoist = true;
            }
            return;
          }
        );
        // If stepResult is a thenable, propagate any errors
        if (isThenable(stepResult)) {
          return stepResult;
        }
        return;
      };
      const runFromIndex = (q: number): MaybePromise<void> => {
        if (q >= queue.length) {
          return;
        }
        const step = runSingleEntry(q);
        if (isThenable(step)) {
          return (step as Promise<void>).then(() => runFromIndex(q + 1));
        }
        return runFromIndex(q + 1);
      };
      return runFromIndex(0);
    };
    const phaseRun = serialForEach(priorities, runPriority);

    if (isThenable(phaseRun)) {
      return (phaseRun as Promise<void>).then(() => {
        return rulesToHoist;
      }).catch((error) => {
        throw error;
      });
    }
    return rulesToHoist;
  }

  /**
   * Coalesce assignment-normalized declaration chains in one stage after evaluation.
   * This handles both in-scope merges and merges that span call-produced Rules blocks.
   */
  private _coalesceMergedDeclarations(rules: Rules): void {
    type DeclOccurrence = {
      node: Node;
      renderKey: RenderKey | undefined;
      ownerRules: Rules;
    };
    const isMergedAssign = (assign: unknown): boolean => (
      assign === '+:' || assign === '&,:' || assign === '&_:'
    );
    const getDeclValue = (decl: Node, renderKey?: RenderKey) => {
      if (!isNode(decl, N.Declaration)) {
        return undefined;
      }
      return renderKey !== undefined
        ? decl.getValue(renderKey)
        : decl.value;
    };
    const setDeclValue = (decl: Node, value: Node, renderKey?: RenderKey): void => {
      if (!isNode(decl, N.Declaration)) {
        return;
      }
      if (renderKey !== undefined) {
        decl.set('value', value, renderKey);
      } else {
        decl.value.value = value;
      }
    };
    const mergeDeclarationValues = (priorValue: Node, nextValue: Node, assign: string): Node => {
      const priorCopy = priorValue.copy(true, freezeChildren);
      const nextCopy = nextValue.copy(true, freezeChildren);
      const toMergedItems = (value: Node): Node[] => {
        const items: Node[] = [];
        const collect = (node: Node): void => {
          if (isNode(node, N.List)) {
            for (const item of node.value) {
              collect(item.copy(true, freezeChildren));
            }
            return;
          }
          let isEmptyString = false;
          try {
            isEmptyString = String(node?.valueOf?.() ?? '') === '';
          } catch {
            isEmptyString = false;
          }
          const isEmptyPlaceholder = (
            isNode(node, N.Nil)
            || isEmptyString
          );
          if (!isEmptyPlaceholder) {
            items.push(node);
          }
        };
        collect(value);
        return items;
      };
      if (assign === '&_:') {
        return spaced([priorCopy, nextCopy]);
      }
      const priorItems = toMergedItems(priorCopy);
      const nextItems = toMergedItems(nextCopy);
      if (priorItems.length > 0 && nextItems.length > 0) {
        const lastPrior = priorItems[priorItems.length - 1]!;
        const firstNext = nextItems[0]!;
        let sameLeadingValue = false;
        try {
          sameLeadingValue = lastPrior.compare(firstNext) === 0 || String(lastPrior.valueOf()) === String(firstNext.valueOf());
        } catch {
          sameLeadingValue = false;
        }
        if (sameLeadingValue) {
          nextItems.shift();
        }
      }
      return new List([...priorItems, ...nextItems]);
    };
    const composeMergedValue = (
      decl: Node,
      declRenderKey: RenderKey | undefined,
      prior: Node,
      priorRenderKey: RenderKey | undefined,
      assign: string,
      priorAccumulatedValue?: Node
    ): Node | undefined => {
      if (!isNode(decl, N.Declaration) || !isNode(prior, N.Declaration)) {
        return undefined;
      }
      const nextDeclValue = getDeclValue(decl, declRenderKey);
      if (!nextDeclValue) {
        return undefined;
      }
      const basePriorValue = priorAccumulatedValue
        ? priorAccumulatedValue.copy(true, freezeChildren)
        : getDeclValue(prior, priorRenderKey)?.value.copy(true, freezeChildren);
      if (!basePriorValue) {
        return undefined;
      }
      const mergedValue = mergeDeclarationValues(basePriorValue, nextDeclValue.value, assign);
      setDeclValue(decl, mergedValue, declRenderKey);
      normalizeMergedDeclarationValue(decl, declRenderKey);
      const declImportant = declRenderKey !== undefined
        ? decl.getValue(declRenderKey).important
        : decl.value.important;
      const priorImportant = priorRenderKey !== undefined
        ? prior.getValue(priorRenderKey).important
        : prior.value.important;
      if (!declImportant && priorImportant) {
        if (declRenderKey !== undefined) {
          decl.getValue(declRenderKey).important = priorImportant;
        } else {
          decl.value.important = priorImportant;
        }
      }
      const mergedDeclValue = getDeclValue(decl, declRenderKey);
      return mergedDeclValue?.value.copy(true, freezeChildren);
    };
    const normalizeMergedDeclarationValue = (node: Node, renderKey?: RenderKey): void => {
      if (!isNode(node, N.Declaration)) {
        return;
      }
      const declValue = getDeclValue(node, renderKey);
      if (!declValue) {
        return;
      }
      const current = declValue.value;
      if (!isNode(current, N.List) || current.value.length === 0) {
        return;
      }
      const [first, ...rest] = current.value;
      let firstIsEmptyString = false;
      try {
        firstIsEmptyString = String(first?.valueOf?.() ?? '') === '';
      } catch {
        firstIsEmptyString = false;
      }
      const isEmptyPlaceholder = Boolean(
        first
        && (
          isNode(first, N.Nil)
          || (isNode(first, N.List) && first.value.length === 0)
          || firstIsEmptyString
        )
      );
      if (!isEmptyPlaceholder) {
        return;
      }
      if (rest.length === 0) {
        setDeclValue(node, new Nil(), renderKey);
        return;
      }
      if (rest.length === 1) {
        setDeclValue(node, rest[0]!.copy(true, freezeChildren), renderKey);
        return;
      }
      setDeclValue(node, new List(rest.map(item => item.copy(true, freezeChildren))), renderKey);
    };

    const lastVisibleByName = new Map<string, DeclOccurrence>();
    const mergedAnchorByName = new Map<string, DeclOccurrence>();
    const accumulatedValueByName = new Map<string, Node>();
    const stream: DeclOccurrence[] = [];
    const collectDeclarationStream = (node: Node, inheritedRenderKey: RenderKey | undefined, ownerRules: Rules): void => {
      if (isNode(node, N.Declaration)) {
        stream.push({ node, renderKey: inheritedRenderKey, ownerRules });
        return;
      }
      if (!isNode(node, N.Rules)) {
        return;
      }
      const effectiveRenderKey = node._renderKey ?? inheritedRenderKey;
      for (const child of node.value) {
        collectDeclarationStream(child, effectiveRenderKey, node);
      }
    };

    for (const node of rules.value) {
      collectDeclarationStream(node, rules._renderKey, rules);
    }

    for (const occurrence of stream) {
      const { node, renderKey, ownerRules } = occurrence;
      if (!isNode(node, N.Declaration)) {
        continue;
      }
      const name = String(node.value.name);
      const assign = String(node.options.normalizedFromAssign ?? '');
      const merged = isMergedAssign(assign);

      if (!merged) {
        mergedAnchorByName.delete(name);
        accumulatedValueByName.delete(name);
        if (node.visible) {
          lastVisibleByName.set(name, occurrence);
        }
        continue;
      }
      normalizeMergedDeclarationValue(node, renderKey);
      let currentAccumulatedValue = getDeclValue(node, renderKey)?.value.copy(true, freezeChildren);

      const prior = lastVisibleByName.get(name);
      const needsCrossScopeCompose = prior
        && (
          prior.ownerRules !== ownerRules
          || prior.renderKey !== renderKey
        );
      if (prior && needsCrossScopeCompose) {
        currentAccumulatedValue = composeMergedValue(
          node,
          renderKey,
          prior.node,
          prior.renderKey,
          assign,
          accumulatedValueByName.get(name)
        ) ?? currentAccumulatedValue;
      }

      const existingAnchor = mergedAnchorByName.get(name);
      if (existingAnchor && isNode(existingAnchor.node, N.Declaration)) {
        const anchorIsSameOccurrence = existingAnchor.node === node
          && existingAnchor.renderKey === renderKey
          && existingAnchor.ownerRules === ownerRules;
        if (!anchorIsSameOccurrence) {
          if (existingAnchor.node === node && existingAnchor.ownerRules !== ownerRules) {
            existingAnchor.ownerRules.removeFlag(F_VISIBLE);
          } else {
            existingAnchor.node.removeFlag(F_VISIBLE);
          }
          mergedAnchorByName.set(name, occurrence);
          if (currentAccumulatedValue) {
            accumulatedValueByName.set(name, currentAccumulatedValue.copy(true, freezeChildren));
          }
          if (node.visible) {
            lastVisibleByName.set(name, occurrence);
          }
          continue;
        }
      }

      mergedAnchorByName.set(name, occurrence);
      if (currentAccumulatedValue) {
        accumulatedValueByName.set(name, currentAccumulatedValue.copy(true, freezeChildren));
      }
      if (node.visible) {
        lastVisibleByName.set(name, occurrence);
      }
    }
  }

  /**
   * Normalize call-produced declaration-only Rules ordering so declarations
   * emitted from late-evaluated calls (e.g. each/$for) appear before nested
   * rulesets/at-rules in the same parent Rules container.
   *
   * This runs after queue evaluation to avoid mutating rule indices mid-eval.
   */
  private _normalizeCallDeclarationRulesOrder(rules: Rules): void {
    const firstNestedIdx = rules.value.findIndex(n => isNode(n, N.Ruleset | N.AtRule));
    if (firstNestedIdx < 0) {
      return;
    }
    const beforeNested = rules.value.slice(0, firstNestedIdx);
    const afterNested = rules.value.slice(firstNestedIdx);
    const shouldMove = (n: Node) => {
      if (
        !isNode(n, N.Rules)
        || !isNode(n.sourceParent, N.Call)
        || n.value.length === 0
        || !n.value.every(child => isNode(child, N.Declaration | N.Comment))
      ) {
        return false;
      }
      const sourceName = n.sourceParent.value.name;
      // Keep mixin-call declaration blocks in source order relative to nested rulesets.
      if (
        isNode(sourceName, N.Reference)
        && (sourceName.options?.type === 'mixin'
          || sourceName.options?.type === 'mixin-ruleset'
          || sourceName.options?.type === 'ruleset')
      ) {
        return false;
      }
      return true;
    };
    const moved = afterNested.filter(shouldMove);
    if (moved.length === 0) {
      return;
    }
    const remainder = afterNested.filter(n => !shouldMove(n));
    rules.set(null, [...beforeNested, ...moved, ...remainder]);
  }

  /**
   * After preEval: ensure root on extend stack, build eval queue, run evaluation.
   * Used by evalNode so that when eval() is called without preEval (e.g. jess compile()),
   * we still have all rulesets registered and root set for extend lookups.
   */
  private _afterPreEvalStep(rules: Rules, context: Context): MaybePromise<{ rules: Rules; rulesToHoist: boolean }> {
    const isMainRoot = rules === context.root;
    if (isMainRoot && context.extendRoots.extendRootStack.length === 0) {
      if (!context.extendRoots.root) {
        context.extendRoots.registerRoot(rules);
      }
      context.extendRoots.pushExtendRoot(rules);
    }
    if (rules.evaluated) {
      return { rules, rulesToHoist: false };
    }
    if (rules === context.root) {
      const map = new WeakMap<Ruleset, number>();
      context.documentOrderByRuleset = map;
      this._assignDocumentOrderDepthFirst(rules, map, { value: 0 });
    }
    const evalQueue = this._buildEvalQueue(rules);
    const maybeHoist = this._evaluateQueue(rules, evalQueue, context);
    if (isThenable(maybeHoist)) {
      return (maybeHoist as Promise<boolean>).then((rulesToHoist) => {
        this._normalizeCallDeclarationRulesOrder(rules);
        this._coalesceMergedDeclarations(rules);
        return {
          rules,
          rulesToHoist
        };
      });
    }
    this._normalizeCallDeclarationRulesOrder(rules);
    this._coalesceMergedDeclarations(rules);
    return { rules, rulesToHoist: maybeHoist as boolean };
  }

  override evalNode(context: Context): MaybePromise<this> {
    const saved = this._snapshotContext(context);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    context.rulesEvalStack.push(this.sourceNode as Rules);
    const restoreContextOnError = () => {
      context.rulesContext = saved.rulesContext;
      if (saved.treeRoot !== undefined) {
        context.treeRoot = saved.treeRoot;
      }
      if (saved.root !== undefined) {
        context.root = saved.root;
      }
      const currentLength = context.extendRoots.extendRootStack.length;
      if (saved.extendRootStackLength !== undefined && currentLength > saved.extendRootStackLength) {
        while (context.extendRoots.extendRootStack.length > saved.extendRootStackLength) {
          context.extendRoots.popExtendRoot();
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      if (context.rulesEvalStack[context.rulesEvalStack.length - 1] === (this.sourceNode as Rules)) {
        context.rulesEvalStack.pop();
      }
      context.depth--;
    };
    let pipeResult: MaybePromise<this>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      pipeResult = pipe(
        () => {
          this._setupContextForRules(context, this);
          // Run preEval first if not yet run (e.g. when jess compile() calls eval() without preEval).
          // preEval registers the root and all nested rulesets so extend lookups find targets in child roots (e.g. .ma inside @media).
          const runPreEvalIfNeeded = (rules: Rules): MaybePromise<Rules> => {
            if (rules.preEvaluated) {
              return rules;
            }
            const result = rules.preEval(context);
            return isThenable(result) ? (result as Promise<Rules>) : result;
          };
          const rulesAfterPreEval = runPreEvalIfNeeded(this);
          const afterPreEval = (rules: Rules) => {
            this._setupContextForRules(context, rules);
            // When we're the outermost Rules, use the tree we're evaling as root (may differ from context.root set in getTree, or be preEval's clone).
            if (context.rulesEvalStack.length === 1) {
              context.root = rules;
            }
            return this._afterPreEvalStep(rules, context);
          };
          if (isThenable(rulesAfterPreEval)) {
            return (rulesAfterPreEval as Promise<Rules>).then(afterPreEval);
          }
          return afterPreEval(rulesAfterPreEval as Rules);
        },
        ({ rules }: { rules: Rules; rulesToHoist: boolean }) => {
        // Note: Rulesets from imported Rules are already registered to their own treeRoot
        // during preEval when the imported Rules node is evaluated. The extend search
        // loops through allRoots, so it should find them. The _searchRulesChildrenForRulesets
        // method in RulesetRegistry also searches imported Rules' registries.

          // After all evaluation stages, check if any variables in the current Rules
          // shadow readonly variables from imported Rules (compose type) at the same level
          // Only check direct children of the Rules node, not nested variables (e.g., inside rulesets)
          if (rules.rulesSet.length > 0) {
            let currentRegistry = rules.getRegistry('declaration');
            currentRegistry.indexPendingItems();
            for (const entry of rules.rulesSet) {
              if (entry.readonly) {
                let importedRegistry = entry.node.getRegistry('declaration');
                importedRegistry.indexPendingItems();
                for (const [key, declarations] of importedRegistry.index) {
                  for (const decl of declarations) {
                    if (isNode(decl, N.VarDeclaration)) {
                    // Check if a variable with this name exists in the current Rules' registry
                      let currentDeclarations = currentRegistry.index.get(key);
                      if (currentDeclarations) {
                        for (const currentDecl of currentDeclarations) {
                          if (isNode(currentDecl, N.VarDeclaration) && !currentDecl.options?.setDefined) {
                          // Only throw if the variable is a direct child of the Rules node (same level)
                          // Nested variables (e.g., inside rulesets) are allowed to shadow
                            if (currentDecl.parent === rules) {
                              throw new ReferenceError(`"${key}" is readonly`);
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }

          // Check if we're at the outermost level BEFORE restoring context
          // Only process extends at the TRUE outermost root (context.root)
          // This ensures extends are processed AFTER all evaluation completes,
          // including imports and nested Rules
          const isOutermost = rules === context.root;

          if (isOutermost) {
            // Process all registered extends using the extend roots registry system
            processExtends(context);
          }
          /** Restore contexts */
          context.rulesContext = saved.rulesContext;
          // Only restore context.treeRoot if saved.treeRoot is defined and we're not at the outermost level
          // If saved.treeRoot is undefined, it means we're at the outermost level, so keep context.treeRoot as is
          // This ensures extends evaluated during selector evaluation can still access the correct treeRoot
          if (saved.treeRoot !== undefined && !isOutermost) {
            context.treeRoot = saved.treeRoot;
          }
          // Only restore context.root if we're not at the outermost level (where it was originally set)
          // If saved.root is undefined, it means we're at the outermost level, so keep context.root as is
          if (saved.root !== undefined && !isOutermost) {
            context.root = saved.root;
          }
          // Restore extend root stack to its original length (if we're not the main root)
          // The main root manages its own push/pop, but nested Rules should restore the stack
          if (!isOutermost && saved.extendRootStackLength !== undefined) {
            const currentLength = context.extendRoots.extendRootStack.length;
            if (currentLength > saved.extendRootStackLength) {
            // Pop any extend roots that were pushed during this Rules evaluation
              while (context.extendRoots.extendRootStack.length > saved.extendRootStackLength) {
                context.extendRoots.popExtendRoot();
              }
            }
          }
          // Pop extend root if we pushed it (check if this is still the root)
          if (rules === context.root) {
            context.extendRoots.popExtendRoot();
          }
          context.rulesEvalStack.pop();
          context.depth--;
          return rules;
        }
      ) as MaybePromise<this>;
    } catch (error) {
      restoreContextOnError();
      throw error;
    }
    if (isThenable(pipeResult)) {
      return (pipeResult as Promise<this>).catch((error) => {
        restoreContextOnError();
        throw error;
      });
    }
    return pipeResult as MaybePromise<this>;
  }
}

export const rules = defineType(Rules, 'Rules');

type EvalQueueMap = Map<Priority, Array<[number, Node]>>;

/**
 * @todo - Will need lots of massaging, to resolve things like
 * mixins which rely on variables which have interpolated names,
 * and variables with interpolated names that rely on mixins.
 *
 * @note - Registration of declaration names and mixins / selectors
 * should have already happened in pre-eval.
 */
const NodeTypeToPriority = new Map([
  /** First, resolve imports */
  ['StyleImport', Priority.Highest],
  /** Then, resolve calls */
  ['Call', Priority.High],
  /** Then, resolve declarations */
  ['VarDeclaration', Priority.Medium],
  ['Declaration', Priority.Medium],
  /** Then... */
  ['Mixin', Priority.Low],
  ['Ruleset', Priority.Low],
  /** Extend should evaluate at the same priority as Ruleset to ensure it evaluates before nested rulesets */
  ['Extend', Priority.Low],
  /** AtRule (e.g., @media) should evaluate at the same priority as Ruleset to preserve source order */
  ['AtRule', Priority.Low]
  /** Then, everything else? */
]);

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
export type MixinEntry = Mixin | Ruleset;

/**
 * A collection of resolved mixin candidates that can be called.
 *
 * This replaces the old `getFunctionFromMixins` closure pattern.
 * Instead of wrapping mixins in a JS function → JsFunction node → callWithContext,
 * Call.evalNode invokes `evalCall` directly.
 *
 * Lives in rules.ts to avoid circular dependencies.
 */
export class MixinCollection extends Node<MixinEntry[]> {
  override adopt() {
    return this;
  }

  async evalCall(context: Context, args?: List<Node>): Promise<Rules> {
    const mixinArr = this.value;
    const mixinLength = mixinArr.length;
    let mixinCandidates: MixinEntry[] = [];
    let evalCandidates: MixinEntry[];
    const thisContext = context;
    let caller = thisContext.caller;
    let sourceParent = caller?.value.name instanceof Node
      ? caller.value.name.sourceParent
      : caller?.sourceParent;
    sourceParent ??= caller;
    let nodeArgs: Node[] = [];
    const savedRulesContext = thisContext.rulesContext;
    const argEvalRulesContext = caller?.rulesParent ?? caller?.sourceRulesParent ?? savedRulesContext;
    thisContext.rulesContext = argEvalRulesContext;
    try {
      for (let arg of (args?.value ?? [])) {
        /**
         * I think they should always be nodes?
         * But leaving this for future expansion.
         */
        if (isNode(arg)) {
          // IMPORTANT: Do not evaluate VarDeclaration args (named arguments) here.
          // Evaluating them can register/override variables in the current scope.
          // They should only be used for parameter binding.
          if (isNode(arg, N.VarDeclaration)) {
            const cloned = arg.copy(true, freezeChildren);
            cloned.frozen = true;
            nodeArgs.push(cloned);
            continue;
          }
          try {
            const evald = await arg.clonedEval(thisContext);
            if (evald.type === 'Rest') {
              const restValue = evald.value;
              if (isNode(restValue, N.Sequence) || isNode(restValue, N.List)) {
                for (const restArg of restValue.value) {
                  const frozenRestArg = restArg.copy(true, freezeChildren);
                  frozenRestArg.frozen = true;
                  nodeArgs.push(frozenRestArg);
                }
                continue;
              }
            }
            evald.frozen = true;
            nodeArgs.push(evald);
          } catch (error: any) {
            throw error;
          }
        } else {
          nodeArgs.push(cast(arg));
        }
      }
    } finally {
      thisContext.rulesContext = savedRulesContext;
    }
    /**
     * Check named and positional arguments
     * against mixins, to see which ones match.
     * (Any mixin with a mis-match of
     * arguments fails.)
     */
    const normalizeBoundLeadingItemWhitespace = (node: Node): void => {
      if (!isNode(node, N.List | N.Sequence)) {
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const items = node.value as Node[];
      if (items.length > 0) {
        items[0]!.pre = 0;
      }
      for (const item of items) {
        if (isNode(item, N.List | N.Sequence)) {
          normalizeBoundLeadingItemWhitespace(item as Node);
        }
      }
    };
    const cloneBoundValue = (value: Node): Node => {
      const boundValue = value.copy(true, freezeChildren);
      boundValue.frozen = true;
      normalizeBoundLeadingItemWhitespace(boundValue);
      return boundValue;
    };
    const resolvedParamBindings = new WeakMap<Mixin, {
      bindings: RuntimeVarBindingRecord[];
      signature: List<Node> | undefined;
    }>();
    for (let i = 0; i < mixinLength; i++) {
      let mixin = mixinArr[i]!;
      let isPlainRule = isNode(mixin, N.Rules);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      let paramLength = isPlainRule ? 0 : (mixin as Mixin).value.params?.length ?? 0;
      if (!paramLength) {
        /** Exit early if args were passed in, but no args are possible */
        if (nodeArgs.length) {
          continue;
        }
        mixinCandidates.push(mixin);
      } else {
        /** The mixin has parameters, so let's check args to see if there's a match */
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const originalParams = (mixin as Mixin).value.params!;
        const bindingRecordsByIndex = new Map<number, RuntimeVarBindingRecord>();
        const signatureNodes: Array<Node | undefined> = new Array(originalParams.length);
        const hasRestParamOriginal = originalParams.value.some(p => p.type === 'Rest');
        const maxPositionalArgs = hasRestParamOriginal ? Number.POSITIVE_INFINITY : originalParams.length;
        let positions = originalParams.length;
        let requiredPositions = 0;
        for (let param of originalParams.value) {
          if (isNode(param, N.VarDeclaration)) {
            if (param.value.value instanceof Nil) {
              requiredPositions++;
            }
          } else if (isNode(param, N.Any) && param.options.role === 'property') {
            // Any with role: 'property' is a parameter without default (consistent with variable names)
            requiredPositions++;
          } else if (param.type !== 'Rest') {
            requiredPositions++;
          }
        }
        let argPos = 0;
        let match = true;
        for (let i = 0; i < positions; i++) {
          let arg = nodeArgs[argPos];
          if (!arg) {
            continue;
          }
          let param: Node | undefined;
          let paramIndex = -1;
          let argValue: Node;
          if (isNode(arg, N.VarDeclaration)) {
            paramIndex = originalParams.value.findIndex(
              (p) => {
                if (isNode(p, N.VarDeclaration)) {
                  return p.value.name.valueOf() === arg.value.name.valueOf();
                }
                if (isNode(p, N.Any) && p.options.role === 'property') {
                  return p.valueOf() === arg.value.name.valueOf();
                }
                return false;
              }
            );
            if (paramIndex >= 0) {
              param = originalParams.value[paramIndex];
              argValue = arg.value.value;
            } else {
              match = false;
              break;
            }
          } else {
            paramIndex = i;
            param = originalParams.value[paramIndex];
            if (!param) {
              match = false;
              break;
            }
            argValue = arg;
          }
          if (!param) {
            match = false;
            break;
          }
          if (isNode(param, N.VarDeclaration)) {
            const boundValue = cloneBoundValue(argValue);
            bindingRecordsByIndex.set(paramIndex, {
              name: param.value.name.valueOf(),
              value: boundValue,
              readonly: param.options.readonly,
              sourceNode: param
            });
            signatureNodes[paramIndex] = boundValue;
          } else if (isNode(param, N.Any) && param.options.role === 'property') {
            const boundValue = cloneBoundValue(argValue);
            bindingRecordsByIndex.set(paramIndex, {
              name: param.valueOf(),
              value: boundValue,
              sourceNode: param
            });
            signatureNodes[paramIndex] = boundValue;
          } else if (param.type === 'Rest') {
            /** We assume that the rest args are values */
            const rest = nodeArgs.slice(argPos).map((restArg) => {
              const cloned = restArg.copy(true, freezeChildren);
              cloned.frozen = true;
              return cloned;
            });
            const restValue = new Sequence(rest);
            const restName = param.value ? `${param.value}` : `rest${i}`;
            bindingRecordsByIndex.set(paramIndex, {
              name: restName,
              value: restValue
            });
            signatureNodes[paramIndex] = restValue;
            /** Check a pattern-matching node */
          } else {
            signatureNodes[paramIndex] = argValue;
            if (param.compare(argValue) !== 0) {
              /** This mixin is not a match */
              match = false;
              break;
            }
          }
          argPos++;
        }
        const positionalArgCount = nodeArgs.filter(argNode => !isNode(argNode, N.VarDeclaration)).length;
        if (positionalArgCount > maxPositionalArgs) {
          continue;
        }
        /**
         * Now we can check remaining positional matches
         * against the remaining parameters.
         */
        if (argPos < requiredPositions) {
          /** This mixin is not a match */
          continue;
        }
        if (nodeArgs.length > 1 && originalParams.value.length === 1 && requiredPositions === 1) {
          // Less should not match single required-parameter overloads against extra positional args.
          continue;
        }
        if (match) {
          for (let i = 0; i < positions; i++) {
            const param = originalParams.value[i]!;
            if (signatureNodes[i]) {
              continue;
            }
            if (isNode(param, N.VarDeclaration)) {
              const defaultValue = cloneBoundValue(param.value.value);
              bindingRecordsByIndex.set(i, {
                name: param.value.name.valueOf(),
                value: defaultValue,
                readonly: param.options.readonly,
                sourceNode: param
              });
              signatureNodes[i] = defaultValue;
            } else if (param.type === 'Rest') {
              const restName = param.value ? `${param.value}` : `rest${i}`;
              const restValue = thisContext.treeContext?.file
                ? new Sequence([])
                : new Any(restName, { role: 'property' });
              bindingRecordsByIndex.set(i, {
                name: restName,
                value: restValue
              });
              signatureNodes[i] = restValue;
            }
          }
          const signature = new List(
            signatureNodes.filter((node): node is Node => Boolean(node)),
            { sep: ';' }
          );
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          resolvedParamBindings.set(mixin as Mixin, {
            bindings: [...bindingRecordsByIndex.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([, binding]) => binding),
            signature
          });
          mixinCandidates.push(mixin);
        }
      }
    }
    /**
     * Alright, we have mixin candidates (mixins that match
     * by arity, pattern, and/or named arguments), now what?
     *
     * First, let's make an evaluation order that evaluates
     * default guards last.
     */
    let hasDefault = false;
    const guardContainsDefault = (node: Node | undefined): boolean => {
      if (!node) {
        return false;
      }
      if (node.type === 'DefaultGuard') {
        return true;
      }
      if (node.type === 'Call') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const callName = String((node as any).value?.name?.valueOf?.() ?? (node as any).value?.name ?? '');
        if (callName === 'default' || callName === '??') {
          return true;
        }
      }
      const value = (node as { value?: unknown }).value;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isNode(item) && guardContainsDefault(item)) {
            return true;
          }
        }
        return false;
      }
      if (value && typeof value === 'object') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const record = value as Record<string, unknown>;
        for (const item of Object.values(record)) {
          if (isNode(item) && guardContainsDefault(item)) {
            return true;
          }
          if (Array.isArray(item)) {
            for (const child of item) {
              if (isNode(child) && guardContainsDefault(child)) {
                return true;
              }
            }
          }
        }
      }
      return false;
    };
    const hasFailedGuardAncestor = (node: Node): boolean => {
      let current: any = node.parent;
      while (current) {
        if (isNode(current, N.Ruleset)) {
          const guardNode = (current as Ruleset).value.guard;
          if (guardNode instanceof Nil) {
            return true;
          }
        }
        current = current.parent;
      }
      return false;
    };
    evalCandidates = mixinCandidates
      .filter((candidate) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const inStack = thisContext.rulesEvalStack.includes(candidate.value.rules.sourceNode as Rules);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const blockedByFailedGuardAncestor = hasFailedGuardAncestor(candidate as unknown as Node);
        return !inStack && !blockedByFailedGuardAncestor;
      })
      .map<MixinEntry>(
        (candidate) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const hasDefaultGuard = Boolean(candidate.options?.hasDefault) || guardContainsDefault(candidate.value.guard as unknown as Node | undefined);
          if (hasDefaultGuard) {
            candidate.options ??= {};
            candidate.options.hasDefault = true;
            hasDefault = true;
          }
          return candidate;
        });

    if (hasDefault) {
      /** There is a default guard, so sort candidates */
      evalCandidates = evalCandidates.slice(0).sort((a, b) => {
        let aDefault = a.options?.hasDefault;
        let bDefault = b.options?.hasDefault;
        /** No guard (or is just a plain ruleset) */
        if (!aDefault && !bDefault) {
          return 0;
        }

        if (!aDefault) {
          return -1;
        }
        if (!bDefault) {
          return 1;
        }
        return 0;
      });
    }

    if (evalCandidates.length === 0) {
      throw new ReferenceError('No matching mixins found.');
    }

    /**
     * Now we have a set of mixins that can return rulesets,
     * but first we need to create a new scope for each mixin,
     * and create variable declarations for each parameter.
     */
    let outputRules: Rules[] = [];
    const debugDefaultGuard = process.env.DEBUG_DEFAULT_GUARD === '1';
    const debugCaller = (): string => {
      const callerName = caller?.value?.name;
      const raw = callerName?.valueOf?.() ?? callerName ?? caller?.type ?? '<unknown>';
      return String(raw);
    };
    const restrictMixinOutputLookup = thisContext.leakyRules !== true;
    const originatesFromReferenceImport = (node: Node): boolean => {
      const queue: any[] = [node, node.sourceNode, node.sourceParent];
      const seen = new Set<any>();
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || seen.has(current)) {
          continue;
        }
        seen.add(current);
        if (current.type === 'StyleImport') {
          const importOptions = current.options?.importOptions;
          if (importOptions?.reference === true || importOptions?._dedupe === true) {
            return true;
          }
        }
        queue.push(current.sourceNode, current.sourceParent, current.parent);
      }
      return false;
    };
    const clearReferenceModeForMixinOutput = (node: Node): void => {
      if (originatesFromReferenceImport(node)) {
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      if ((node.options as any)?.referenceMode === true) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (node.options as any).referenceMode = false;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const nestedRules = (node as any).value?.rules;
      if (nestedRules && isNode(nestedRules, N.Rules)) {
        clearReferenceModeForMixinOutput(nestedRules as Node);
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const children = (node as any).value;
      if (Array.isArray(children)) {
        for (const child of children) {
          if (isNode(child, N.Rules | N.Ruleset | N.AtRule)) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            clearReferenceModeForMixinOutput(child as Node);
          }
        }
      }
    };
    const getRootSourceRules = (rules: Rules): Rules => {
      let current = rules;
      const seen = new Set<Rules>();
      while (current.sourceNode && isNode(current.sourceNode, N.Rules)) {
        const next = current.sourceNode as Rules;
        if (next === current || seen.has(next)) {
          break;
        }
        seen.add(current);
        current = next;
      }
      return current;
    };

    const DEF_FALSE_EITHER = -1;
    const DEF_NONE = 0;
    const DEF_TRUE = 1;
    const DEF_FALSE = 2;
    type DefaultPendingCandidate = {
      candidate: Mixin;
      rules: Rules;
      outerRules?: Rules;
      params?: List<Node>;
      group: number;
    };
    const pendingDefaultCandidates: DefaultPendingCandidate[] = [];
    let hasDefNoneCandidate = false;
    const evaluateCandidateOutput = async (
      candidate: Mixin,
      rules: Rules,
      outerRules: Rules | undefined,
      params: List<Node> | undefined
    ): Promise<void> => {
      const currentCall = thisContext.callStack.at(-1);
      // to prevent infinite loops (e.g., .recursion { .recursion(); })
      if (currentCall && thisContext.callMap.add(currentCall, params)) {
        // Recursive call detected - skip this candidate (don't add to outputRules)
        // This allows other candidates to still match
        return;
      }

      // Allocate a unique renderKey per call so shared body nodes fork their
      // `.value` state on mutation during eval, and so the recently-reused
      // re-eval machinery in Node.evalStatic can detect and re-evaluate
      // canonical nodes against this call's scope.
      //
      // NB: assign `_renderKey` on the call's wrapper BEFORE pushing children
      // into it. `adopt` writes to `_parentForks[thisRenderKey]` only when the
      // parent has a renderKey — setting it afterward would leave the shared
      // body children with a canonical-only parent chain, and the last call
      // to adopt would overwrite `child.parent` for every previous call. That
      // wrecks per-call scope lookups, selector composition, and serialization
      // renderKey propagation (which uses the Rules ancestor chain).
      const renderKey = thisContext.ruleCounter++;
      if (outerRules) {
        outerRules._renderKey = renderKey;
      } else {
        rules._renderKey = renderKey;
      }
      thisContext.renderKeyStack.push(renderKey);
      try {
        let newRules: Rules;
        if (!outerRules) {
          candidate.parent!.adopt(rules);
          newRules = await rules.eval(thisContext);
        } else {
          // Evaluate in the wrapper scope so params are visible, but preserve the wrapper's
          // rulesVisibility (it keeps VarDeclaration public). Overwriting visibility here can
          // hide param vars from registry-based lookup.
          outerRules.push(...rules.value);
          newRules = await outerRules.eval(thisContext);
        }
        newRules._renderKey = renderKey;
        candidate.parent!.adopt(newRules);
        // Rules should have index from eval, but ensure it matches candidate for sorting
        newRules.index = candidate.index;

        // Visibility should be preserved by Rules.eval - no need to set it explicitly here
        // The eval'd rules should already have their nodes registered
        // Ensure the registry is indexed before checking
        // Mark output Rules as mixin output - accessible only when lookup has a target
        newRules.options.isMixinOutput = restrictMixinOutputLookup;
        newRules.options.referenceMode = false;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        clearReferenceModeForMixinOutput(newRules as unknown as Node);
        outputRules.push(newRules);
      } catch (error) {
        // If recursion was detected (ReferenceError), skip this candidate
        // This allows other candidates to still match
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        if (error instanceof ReferenceError && (error as any).message?.includes('Recursive mixin call')) {
          // Skip this candidate - recursion detected
          return;
        }
        // Re-throw other errors
        throw error;
      } finally {
        if (currentCall) {
          thisContext.callMap.delete(currentCall);
        }
        thisContext.renderKeyStack.pop();
      }
    };

    for (let candidate of evalCandidates) {
      if (isNode(candidate, N.Ruleset)) {
        // For Rulesets, guard was already evaluated at definition time in Ruleset.evalNode
        // guard === undefined means passed, guard instanceof Nil means failed
        const rulesetGuard = (candidate as Ruleset).value.guard;
        if (rulesetGuard instanceof Nil) {
          // Guard failed at definition time - skip this ruleset
          continue;
        }
        const candidateRules = (candidate as Ruleset).value.rules;
        const sourceRules = getRootSourceRules(candidateRules);
        let rules = sourceRules.clone(true);
        const callParent = (caller?.parent as Node | undefined) ?? candidate.parent!;
        // Allocate a renderKey per ruleset-as-mixin call so shared body
        // children (the nested Rulesets like `.bar`) get per-call forks for
        // their composed selectors. Without this, the cached selector from
        // the original render (e.g. `.container .foo .bar`) leaks into the
        // call site where the selector should be just `.bar`.
        const renderKey = thisContext.ruleCounter++;
        rules._renderKey = renderKey;
        /** Adopt for lookup, then adopt for sorting */
        callParent.adopt(rules);
        rules.sourceParent = sourceParent;
        let originalContext = thisContext.rulesContext;
        thisContext.rulesContext = rules;
        thisContext.renderKeyStack.push(renderKey);
        try {
          rules = await rules.eval(thisContext);
        } finally {
          thisContext.renderKeyStack.pop();
          thisContext.rulesContext = originalContext;
        }
        rules._renderKey = renderKey;
        callParent.adopt(rules);
        // Rules should have index from eval, but ensure it matches candidate for sorting
        rules.index = candidate.index;
        // Skip empty Rules (e.g., containing only invisible nodes like comments)
        // Mark output Rules as mixin output - accessible only when lookup has a target
        rules.options.isMixinOutput = restrictMixinOutputLookup;
        rules.options.referenceMode = false;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        clearReferenceModeForMixinOutput(rules as unknown as Node);
        outputRules.push(rules);
        continue;
      }
      // Less detached rulesets are represented as anonymous mixins (name is undefined).
      // Calling `@rulesetVar();` should *unlock* the rules into scope (including mixin definitions),
      // not eagerly execute/flatten them.
      if (!candidate.value.name && !candidate.value.params && !candidate.value.guard) {
        const sourceRules = getRootSourceRules(candidate.value.rules);
        let unlocked = sourceRules.clone(false);
        candidate.parent!.adopt(unlocked);
        unlocked.sourceParent = sourceParent ?? caller;
        // Mark as mixin output; caller may override when leakyRules=true
        unlocked.options.isMixinOutput = restrictMixinOutputLookup;
        unlocked.options.referenceMode = false;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        clearReferenceModeForMixinOutput(unlocked as unknown as Node);
        unlocked.index = candidate.index;
        outputRules.push(unlocked);
        continue;
      }
      let rules = candidate.value.rules;
      /** Create new rules, and add the candidate rules, to add to scope */
      rules = rules.clone(true);
      // Mixin body vars should follow the same leaky/non-leaky visibility model as
      // rulesets: visible outside only in Less/leaky mode, while remaining available
      // as same-scope siblings during body evaluation either way.
      rules.options.rulesVisibility ??= {};
      rules.options.rulesVisibility.VarDeclaration = thisContext.leakyRules ? 'public' : 'private';
      candidate.parent!.adopt(rules);
      rules.sourceParent = sourceParent;
      // Don't set index before evaluation - let evaluation assign the correct index
      /**
       * If we have params or a guard, we need to create a wrapper rules object,
       * so that the lookups of params and guard do not look at the cloned rules,
       * but instead look upwards / outwards.
       */
      let outerRules: Rules | undefined;

      /** Now we need to add our parameters, if any */
      const resolvedBindingInfo = isNode(candidate, N.Mixin)
        ? resolvedParamBindings.get(candidate as Mixin)
        : undefined;
      let params = resolvedBindingInfo?.signature;
      const paramBindings = resolvedBindingInfo?.bindings ?? [];
      if (candidate.value.params || paramBindings.length > 0) {
        outerRules = Rules.create([], {
          rulesVisibility: {
            Ruleset: 'public',
            Declaration: 'public',
            VarDeclaration: 'public',
            Mixin: 'public'
          }
        });
        (thisContext.rulesContext ?? candidate.parent!).adopt(outerRules);
        outerRules.sourceParent = sourceParent;
        outerRules.index = candidate.index;
        // Mark param source nodes and build the live-slot map for the ScopeFrame.
        const liveSlots = new Map<string, BindingCell>();
        for (const binding of paramBindings) {
          if (isNode(binding.sourceNode, N.VarDeclaration)) {
            binding.sourceNode.options ??= {};
            binding.sourceNode.options.paramVar = true;
            binding.sourceNode.removeFlag(F_VISIBLE);
          }
          liveSlots.set(binding.name, {
            value: binding.value,
            sourceNode: binding.sourceNode as Node | undefined,
            readonly: binding.readonly
          });
        }
        // @arguments: build the Sequence first (mutable array filled below),
        // then put it in the live-slot map so it's found via the frame chain.
        const shouldDefineArguments = Boolean(thisContext.treeContext?.file);
        let argumentsArgs: Node[] | undefined;
        if (shouldDefineArguments) {
          argumentsArgs = [];
          liveSlots.set('arguments', {
            value: new Sequence(argumentsArgs),
            readonly: true
          });
        }
        // Wire the ScopeFrame with call-site parent and the populated live slots.
        const callSiteRules = thisContext.rulesContext;
        const parentFrame: ScopeFrame | undefined = isNode(callSiteRules, N.Rules)
          ? (callSiteRules as Rules).getScopeFrame()
          : undefined;
        outerRules.scopeFrame = buildScopeFrame(undefined, outerRules, parentFrame, liveSlots);
        // Populate @arguments after the frame is wired (the Sequence holds a
        // reference to argumentsArgs, so pushes here are visible through the frame).
        if (shouldDefineArguments && argumentsArgs) {
          const paramValues = paramBindings.map(binding => binding.value);
          const argumentNodes = (paramValues && paramValues.length > 0) ? paramValues : nodeArgs;
          for (const argNode of argumentNodes) {
            // If a Rest param collected args into a Sequence, spread its items
            // so @arguments reflects the actual argument count
            if (isNode(argNode, N.Sequence)) {
              for (const item of (argNode as { value: Node[] }).value) {
                const cloned = item.copy(true, freezeChildren);
                cloned.frozen = true;
                argumentsArgs.push(cloned);
              }
            } else {
              const cloned = argNode.copy(true, freezeChildren);
              cloned.frozen = true;
              argumentsArgs.push(cloned);
            }
          }
        }
      }

      /** Now we can evaluate our guards, if any */
      let guard: Condition | Bool | undefined = candidate.value.guard?.copy(true);
      let passes = true;
      let rulesContext = thisContext.rulesContext;
      // Call-time resolution is handled by the current context.rulesContext
      thisContext.rulesContext = outerRules ?? rules;
      try {
        if (guard) {
          outerRules ??= Rules.create([]);
          outerRules.adopt(guard);
          candidate.parent!.adopt(outerRules);
          /** Allow lookup on the inherited rules */
          passes = false;
          let guardPasses = false;
          let defaultGroup = DEF_FALSE_EITHER;
          if (hasDefault) {
            const originalIsDefault = thisContext.isDefault;
            const evalWithDefault = async (isDefaultValue: boolean): Promise<boolean> => {
              const probeGuard = candidate.value.guard?.copy(true);
              if (!probeGuard) {
                return false;
              }
              outerRules!.adopt(probeGuard);
              thisContext.isDefault = isDefaultValue;
              const probeResult = await probeGuard.eval(thisContext);
              return probeResult instanceof Bool && probeResult.value === true;
            };
            const passWhenDefaultFalse = await evalWithDefault(false);
            const passWhenDefaultTrue = await evalWithDefault(true);
            thisContext.isDefault = originalIsDefault;
            if (debugDefaultGuard) {
              console.log('[default-guard:candidate]', JSON.stringify({
                caller: debugCaller(),
                candidate: candidate.value.name?.valueOf?.() ?? '<anon>',
                guard: candidate.value.guard?.valueOf?.() ?? candidate.value.guard?.toString?.() ?? '',
                params: candidate.value.params?.value?.map((param: any) => param?.valueOf?.() ?? String(param)) ?? [],
                passWhenDefaultFalse,
                passWhenDefaultTrue
              }));
            }
            if (passWhenDefaultFalse || passWhenDefaultTrue) {
              passes = true;
              if (passWhenDefaultFalse && passWhenDefaultTrue) {
                defaultGroup = DEF_NONE;
                hasDefNoneCandidate = true;
              } else {
                defaultGroup = passWhenDefaultTrue ? DEF_TRUE : DEF_FALSE;
              }
            }
            guardPasses = passes;
            if (passes) {
              pendingDefaultCandidates.push({
                candidate: candidate as Mixin,
                rules,
                outerRules,
                params,
                group: defaultGroup
              });
            }
          } else {
            /** All nodes need context to be evaluated */
            thisContext.isDefault = false;
            guard = await guard.eval(thisContext);
            /** Less guards only pass on explicit Bool(true), never JS truthiness. */
            guardPasses = guard instanceof Bool && guard.value === true;
            if (guardPasses) {
              passes = true;
              hasDefNoneCandidate = true;
            }
          }
        }
        if (!passes) {
          continue;
        }
        if (!guard || !hasDefault) {
          // Non-default candidates are equivalent to Less's defNone group
          // (match regardless of default() assumption), so they suppress ambiguity.
          hasDefNoneCandidate = true;
        }
        if (guard && hasDefault) {
          continue;
        }
        await evaluateCandidateOutput(candidate as Mixin, rules, outerRules, params);
      } finally {
        thisContext.rulesContext = rulesContext;
      }
    }

    if (pendingDefaultCandidates.length > 0) {
      let defTrueCount = 0;
      let defFalseCount = 0;
      for (const pending of pendingDefaultCandidates) {
        if (pending.group === DEF_TRUE) {
          defTrueCount++;
        } else if (pending.group === DEF_FALSE) {
          defFalseCount++;
        } else if (pending.group === DEF_NONE) {
          hasDefNoneCandidate = true;
        }
      }

      const defaultResult = hasDefNoneCandidate ? DEF_FALSE : DEF_TRUE;
      if (debugDefaultGuard) {
        console.log('[default-guard:resolution]', JSON.stringify({
          caller: debugCaller(),
          hasDefNoneCandidate,
          defTrueCount,
          defFalseCount,
          defaultResult
        }));
      }
      if (!hasDefNoneCandidate && (defTrueCount + defFalseCount) > 1) {
        throw new ReferenceError('Ambiguous use of default() while matching mixins.');
      }

      for (const pending of pendingDefaultCandidates) {
        if (pending.group !== DEF_NONE && pending.group !== defaultResult) {
          continue;
        }
        const previousRulesContext = thisContext.rulesContext;
        thisContext.rulesContext = pending.outerRules ?? pending.rules;
        try {
          await evaluateCandidateOutput(
            pending.candidate,
            pending.rules,
            pending.outerRules,
            pending.params
          );
        } finally {
          thisContext.rulesContext = previousRulesContext;
        }
      }
    }

    /**
     * Now that we have output rules, sort them by
     * their original order
     */
    outputRules.sort(comparePosition);
    /** Create a rules wrapper - but optimize to avoid unnecessary nesting */
    let output: Rules;
    if (outputRules.length === 1) {
      output = outputRules[0]!;
      // Ensure single output rule is marked as mixin output
      output.options.isMixinOutput = restrictMixinOutputLookup;
      output.options.referenceMode = false;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      clearReferenceModeForMixinOutput(output as unknown as Node);
    } else {
      /**
       * Wrap these in rules marked as mixin output - accessible only when lookup has a target.
       * This prevents mixin output from being searched by untargeted lookups.
       */
      output = Rules.create([], {
        rulesVisibility: {
          Ruleset: 'public',
          Declaration: 'public',
          VarDeclaration: 'public',
          Mixin: 'public'
        },
        isMixinOutput: restrictMixinOutputLookup,
        referenceMode: false
      });
      /**
       * Add rules but keep their original parents for further lazy lookups.
       * Ensure each rule has VarDeclaration: 'optional' before pushing (registerNode uses node's own rulesVisibility)
       */
      for (let i = 0; i < outputRules.length; i++) {
        let rule = outputRules[i]!;
        rule.frozen = true;
        /** Set a sequential index for lookup sorting */
        rule.index = i;
        output.push(rule);
      }
    }

    /**
     * IMPORTANT: Do NOT force `output` to be evaluated here.
     *
     * Even though candidate rule bodies are usually evaluated during mixin execution, callers
     * (e.g. `Call.evalNode`) rely on `.eval(context)` to finish evaluation. Marking these flags
     * true can skip evaluation and leak unevaluated nodes (like `Call`) into serialization.
     */
    /** Now push all rules into the rules value */
    output.index ??= thisContext.ruleCounter++;
    if (output.value.length === 0) {
      return Rules.create([]);
    }
    return output;
  }
}

defineType(MixinCollection, 'MixinCollection', 'mixincoll');
