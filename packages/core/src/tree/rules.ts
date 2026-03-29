import {
  Node,
  defineType,
  type NodeOptions,
  type LocationInfo, type OptionalLocation,
  type TreeContext,
  F_STATIC,
  F_VISIBLE
} from './node.js';
import { Context } from '../context.js';
import type { EvalState } from '../eval-state.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { type Ruleset } from './ruleset.js';
import { type Mixin } from './mixin.js';
import type { Selector } from './selector.js';
import { spaced, Sequence } from './sequence.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';

import { atIndex } from './util/collections.js';
import * as Registries from './util/registry-utils.js';
import { processExtends } from './util/extend-roots.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import { Nil } from './nil.js';
import { VarDeclaration } from './declaration-var.js';
import type { Declaration } from './declaration.js';
import { Any } from './any.js';
import { List } from './list.js';
import { indent, normalizeIndent } from './util/serialize-helper.js';
import {
  getChildren,
  getField,
  getParent,
  getSourceParent,
  setField,
  setChildren,
  setChildAt,
  setIndex,
  setParent,
  isPreEvaluated,
  isEvaluated
} from './util/field-helpers.js';
import {
  dispatchMixinEvalCandidates,
  evaluateCandidateOutput,
  evaluateMixinArgs,
  filterAndSortMixinEvalCandidates,
  finalizeMixinInvocationReturn,
  getCandidateParent,
  matchMixinCandidates,
  type EvaluateCandidateOutputOptions
} from './util/mixin-instance-primitives.js';
import type { Func } from './function.js';
const { isArray } = Array;

export const enum Priority {
  None = 0,
  Low = 1,
  Medium = 2,
  High = 3,
  Highest = 4
}
export type RulesVisibility = 'public' | 'optional' | 'private';

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
  readonly value: readonly Node[];
  get options(): RulesOptions & NodeOptions & {
    rulesVisibility: Record<string, RulesVisibility>;
  };
  set options(options: RulesOptions & NodeOptions & {
    rulesVisibility: Record<string, RulesVisibility>;
  });
  getCurrentOptions(context?: Context): RulesOptions & NodeOptions & {
    rulesVisibility: Record<string, RulesVisibility>;
  };
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
export interface Rules {
  type: 'Rules' | 'RawRules' | 'Collection';
  shortType: 'rules' | 'rules-raw' | 'coll';
}
export class Rules extends Node<Node[], RulesOptions & NodeOptions> {
  static override childKeys = ['value'] as const;

  readonly value!: readonly Node[];

  functionRegistry: Registries.FunctionRegistry | undefined;

  getCurrentOptions(context?: Context): RulesOptions & NodeOptions & {
    rulesVisibility: Record<string, RulesVisibility>;
  } {
    return context
      ? getField<RulesOptions & NodeOptions & {
        rulesVisibility: Record<string, RulesVisibility>;
      }>(this, 'options', context)
      : this.options;
  }

  setCurrentOptions(
    options: RulesOptions & NodeOptions & {
      rulesVisibility: Record<string, RulesVisibility>;
    },
    context?: Context
  ): void {
    if (context && this === this.sourceNode) {
      setField(this, 'options', options, context);
      return;
    }
    this.options = options;
  }

  private _cloneOptionsForContext(context?: Context): (RulesOptions & NodeOptions) | undefined {
    const options = context
      ? this.getCurrentOptions(context)
      : (this as any)._meta?.options as (RulesOptions & NodeOptions) | undefined;
    if (!options) {
      return undefined;
    }
    return {
      ...options,
      rulesVisibility: options.rulesVisibility
        ? { ...options.rulesVisibility }
        : options.rulesVisibility
    };
  }

  /**
   * Rules are often cloned during `preEval()` when a session is active.
   * If callers register functions/mixins/declarations on the parsed tree
   * before evaluation (e.g. via visitors), those registries must survive cloning so
   * lookups during evaluation work as expected.
   */
  override clone(deep?: boolean, cloneFn?: (n: Node) => Node, ctx?: Context): this {
    const options = this._cloneOptionsForContext(ctx);
    const location = Array.isArray(this.location) && this.location.length === 6
      ? this.location as LocationInfo
      : undefined;
    const newRules = deep
      ? super.clone(deep, cloneFn, ctx)
      : new (this.constructor as typeof Rules)(
        this.value,
        options ? { ...options } : undefined,
        location,
        this.treeContext
      ) as this;

    if (deep && options) {
      newRules.options = options;
    }

    if (!deep) {
      newRules.inherit(this);
    }

    if (ctx) {
      const parent = getParent(this, ctx);
      if (parent) {
        setParent(newRules, parent, ctx);
      }
    }

    // Only preserve *function* registry across clones.
    // This supports Less plugin compat, where plugins can inject functions into the registry
    // without creating AST nodes that would be re-registered on clone.
    //
    // Do NOT reuse declaration/mixin/ruleset registries across clones; those should always
    // be rebuilt from AST nodes via lazy indexing.
    if (this.functionRegistry) {
      newRules.functionRegistry = this.functionRegistry.cloneForRules(newRules);
    }

    return newRules;
  }

  /**
   * Detached ruleset calls unlock shared top-level children into the active
   * lookup scope, but must not canonically reparent those children.
   *
   * Keep this seam local to Rules so the detached-ruleset path does not need
   * to rely on raw clone(false) semantics.
   */
  cloneDetachedUnlockWrapper(ctx: Context): this {
    return this.cloneLookupSafeShallowWrapper(ctx);
  }

  /**
   * Scope-isolation callers need copied Rules options/visibility while keeping
   * shared top-level children canonically parented. Active lookups should still
   * resolve through the wrapper during the current session.
   */
  cloneVisibilityIsolationWrapper(ctx: Context): this {
    return this.cloneLookupSafeShallowWrapper(ctx);
  }

  /**
   * Lazily create registries for types as needed.
   */
  private static _registryKey(type: string): '_rulesetRegistry' | '_mixinRegistry' | '_declarationRegistry' | 'functionRegistry' {
    // functionRegistry keeps its existing name (no underscore) for backward compatibility
    return type === 'function' ? 'functionRegistry' : `_${type}Registry` as any;
  }

  private static _registryClass(type: string) {
    return Registries[`${type.charAt(0).toUpperCase()}${type.slice(1)}Registry` as 'RulesetRegistry' | 'MixinRegistry' | 'DeclarationRegistry' | 'FunctionRegistry'];
  }

  /**
   * Register a child node into the appropriate registry.
   * Creates the registry lazily on first registration.
   * With context: writes to the state-scoped registry on NodeState.
   * Without context: writes to the instance property (canonical).
   */
  register(
    type: 'ruleset' | 'declaration' | 'mixin' | 'function',
    node: Node,
    context?: Context
  ) {
    const key = Rules._registryKey(type);
    if (context) {
      const ns = context.activeState.get(this);
      let registry = ns[key];
      if (!registry) {
        registry = new (Rules._registryClass(type))(this, context) as any;
        ns[key] = registry as any;
      }
      return (registry as any).add(node);
    }
    let registry = (this as any)[key];
    if (!registry) {
      registry = new (Rules._registryClass(type))(this);
      (this as any)[key] = registry;
    }
    return registry.add(node);
  }

  /**
   * Get a registry for lookups. Read-only — returns undefined if no
   * registry was ever created (meaning nothing was registered).
   */
  getRegistry(type: 'ruleset', context?: Context): Registries.RulesetRegistry;
  getRegistry(type: 'declaration', context?: Context): Registries.DeclarationRegistry;
  getRegistry(type: 'mixin', context?: Context): Registries.MixinRegistry;
  getRegistry(type: 'function', context?: Context): Registries.FunctionRegistry;
  getRegistry(type: 'ruleset' | 'declaration' | 'mixin' | 'function', context?: Context): Registries.RulesetRegistry | Registries.DeclarationRegistry | Registries.MixinRegistry | Registries.FunctionRegistry;
  getRegistry(type: 'ruleset' | 'declaration' | 'mixin' | 'function', context?: Context) {
    const key = Rules._registryKey(type);
    if (context) {
      let state: EvalState | undefined = context.activeState;
      while (state) {
        const registry = state.peek(this)?.[key];
        if (registry) {
          return registry;
        }
        state = state.parent;
      }
    }
    // Fall back to instance property; create if missing.
    // Empty registries are cheap — just a Map. The parent/child walk
    // infrastructure needs a registry instance even when nothing is registered.
    let registry = (this as any)[key];
    if (!registry) {
      registry = new (Rules._registryClass(type))(this, context);
      (this as any)[key] = registry;
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
    const registry = this.getRegistry(type, options.context);
    return (registry.find as Function)(keys, filterType, options);
  }

  findStatePatchedFunction(
    name: string,
    options: Registries.FindOptions = {}
  ): ReturnType<Registries.FunctionRegistry['find']> | undefined {
    const { filter, context, searchParents = true } = options;
    let rules: Rules | undefined = this;
    let findRoot = false;

    while (rules) {
      for (const child of rules._getChildren(context)) {
        if (!isNode(child, N.Func)) {
          continue;
        }
        if (filter && !filter(child)) {
          continue;
        }
        if ((child as Func).getNameKey(context) === name) {
          return child as Func;
        }
      }

      if (!searchParents) {
        break;
      }

      do {
        rules = getParent(rules, context) as Rules | undefined;
        if (findRoot && rules?.type === 'Rules' && getParent(rules, context) === undefined) {
          break;
        }
        if (rules && rules.sourceNode?.type === 'StyleImport' && rules.sourceNode.options.type !== 'import') {
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
    options = getPrintOptions(options);
    const w = options.writer!;
    const depth = options.depth!;
    const mark = w.mark();

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
        for (const node of this._getChildren(ctx)) {
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
      // Ensure exactly one trailing newline (only if there's content)
      return result ? result + '\n' : '';
    }
    return w.getSince(mark);
  }

  pendingExtends = new Set<[find: Selector, extendWith: Selector, partial: boolean]>();

  private _setValueArray(value: Node[]): void {
    (this as unknown as { value: Node[] }).value = value;
  }

  /**
   * Create a shallow body wrapper for mixin eval — O(N) array copy vs O(N²) deep clone.
   *
   * Creates a new Rules with a COPY of the children array but does NOT adopt children
   * (their canonical .parent stays unchanged). Session/IR handles the per-call parent
   * chain via overlay. Registries are left empty — they'll be populated during eval.
   *
   * This replaces clone(true) in the mixin body path for massive perf improvement:
   * a mixin body with 100 declarations creates 1 array copy + 1 Rules object
   * instead of recursively cloning all 100+ nodes.
   */
  createShallowBodyWrapper(ctx?: Context): Rules {
    const options = this._cloneOptionsForContext(ctx);
    const location = Array.isArray(this.location) && this.location.length === 6
      ? this.location as LocationInfo
      : undefined;
    // Create a new Rules with empty children — bypass constructor adoption
    const wrapper = new (this.constructor as typeof Rules)(
      [],
      options ? { ...options } : undefined,
      location,
      this.treeContext
    );
    // Now set the children array directly — NOT through the constructor
    // so adopt() is NOT called on canonical children.
    wrapper._setValueArray([...this.value]);
    wrapper.inherit(this);
    // Set state parent for each child to the wrapper
    if (ctx) {
      for (const child of wrapper.value) {
        if (child instanceof Node) {
          wrapper.adopt(child, ctx);
        }
      }
    }
    return wrapper;
  }

  constructor(
    value: readonly Node[],
    options?: RulesOptions & NodeOptions,
    location?: OptionalLocation,
    context?: Context | TreeContext
  ) {
    const treeContext = context instanceof Context
      ? context.treeContext
      : context;
    const ctx = context instanceof Context
      ? context
      : undefined;

    let rulesVisibility = options?.rulesVisibility ?? {};
    rulesVisibility.Declaration ??= 'public';
    rulesVisibility.Ruleset ??= 'public';
    rulesVisibility.VarDeclaration ??= 'public';
    rulesVisibility.Mixin ??= 'public';
    const mergedOptions = { ...options, rulesVisibility };
    const normalized = (value ?? []) as Node[];
    super(normalized, mergedOptions, location, treeContext);
    this._setValueArray(normalized);
    for (const child of normalized) {
      if (child instanceof Node) {
        this.adopt(child, ctx);
        this.registerNode(child);
      }
    }
    this.allowRoot = true;
    this.allowRuleRoot = true;
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

  private _getChildren(context?: Context): readonly Node[] {
    return context
      ? getChildren(this, context)
      : this.value;
  }

  private _setChildren(value: readonly Node[], context?: Context, markDirty: boolean = true): void {
    if (context) {
      setChildren(this, value, context, { markDirty });
      return;
    }
    this.setData([...value]);
  }

  private _setChildAt(index: number, node: Node, context?: Context, markDirty: boolean = true): void {
    if (context) {
      setChildAt(this, index, node, context, { markDirty });
      return;
    }
    this.setData(index, node);
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
    const value = this._getChildren(options.context);
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
      const rulesNode = node as Rules;
      const rulesValue = rulesNode._getChildren(options.context);
      if (rulesValue.length !== 1) {
        return false;
      }
      const only = rulesValue[0]!;
      return only.type === 'Any' && (only as Any).role === 'any';
    };

    let emittedCount = 0;
    let lastEmittedType: string | undefined;
    let lastEmittedWasInlineSourceRules = false;
    for (let idx = 0; idx < items.length; idx++) {
      const n = items[idx]!;
      const isContainer = n.type === 'Ruleset' || n.type === 'AtRule' || n.type === 'Rules';
      if (referenceMode && !referenceRenderEnabled && !isContainer) {
        continue;
      }
      if (emittedCount > 0) {
        // Check actual buffer state - not just previous captured output
        // Frame closing in serializeRulesContainer adds newlines that aren't in the capture
        const currentBuffer = w.getSince(0);
        const bufferEndsWithNewline = currentBuffer.endsWith('\n');
        const needsInlineBoundarySpacing = (
          (lastEmittedType === 'Any' && n.type !== 'Any')
          || (lastEmittedWasInlineSourceRules && n.type !== 'Any')
        );
        if (!bufferEndsWithNewline || needsInlineBoundarySpacing) {
          w.add('\n');
        }
      }
      const isChildRules = n.type === 'Rules';
      const isRulesetOrAtRule = n.type === 'Ruleset' || n.type === 'AtRule';
      // Add indentation only for simple nodes (declarations, etc.)
      // Ruleset and AtRule nodes indent themselves in renderOpening
      if (!isChildRules && !isRulesetOrAtRule && depth !== 0) {
        w.add(space);
      }

      // Emit directly to preserve source map segments
      // For child Rules nodes, pass the same depth (don't increment depth)
      // Rules nodes inside Rules nodes are at the same level
      let childOptions = isChildRules
        ? { ...options, depth }
        : { ...options, depth };
      if (isChildRules) {
        const ownReferenceMode = (n.options as any)?.referenceMode === true;
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
      let rule = w.capture(() => n.toTrimmedString(childOptions));
      if (!rule && (n.type === 'Ruleset' || n.type === 'AtRule' || n.type === 'Rules')) {
        continue;
      }
      w.add(rule, n); // Pass node as origin to preserve location info
      const needsSemi = isNode(n, N.Declaration | N.VarDeclaration)
        ? (n as Declaration).requiresSemi(childOptions.context)
        : n.requiredSemi;
      if (needsSemi && n.options.semi !== false) {
        w.add(';', n);
      }
      emittedCount++;
      lastEmittedType = n.type;
      lastEmittedWasInlineSourceRules = isInlineSourceRules(n);
    }
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    // Push this node's subtree (if any) so child nodes resolve
    // patched fields during serialization.
    const ctx = options.context;
    const subtree = this._carriedState as EvalState | undefined
      ?? ctx?.activeState.peek(this)?._subtree
      ?? ctx?.subtreeMap.get(this);
    if (ctx && subtree) {
      ctx.pushState(subtree);
    }
    this._emitRulesBody(options);
    if (ctx && subtree) {
      ctx.popState();
    }
    return w.getSince(mark);
  }

  /** All rules, with nested rules flattened */
  flatRules(visibleOnly: boolean = false, context?: Context, positionMap?: WeakMap<Node, EvalState>) {
    const finalRules: Node[] = [];
    const iterateRules = (rules: Rules, activeSubtree?: EvalState) => {
      const subtree = (rules._carriedState as EvalState | undefined)
        ?? context?.activeState.peek(rules)?._subtree
        ?? context?.subtreeMap.get(rules)
        ?? activeSubtree;

      for (let n of rules._getChildren(context)) {
        if (isNode(n, N.Rules)) {
          if ((n.options as RulesOptions)?.referenceMode === true) {
            finalRules.push(n);
          } else {
            iterateRules(n, subtree);
          }
          continue;
        }
        if (!visibleOnly || n.visible || n.fullRender) {
          if (positionMap && subtree) {
            positionMap.set(n, subtree);
          }
          finalRules.push(n);
        }
      }
    };
    iterateRules(this);
    return finalRules;
  }

  visibleRules(context?: Context) {
    return this._getChildren(context).filter(n => n.visible);
  }

  /**
   * Return an object representation of a ruleset
   */
  toObject(convertToPrimitives: true, context?: Context): Record<string, string | number | boolean>;
  toObject(convertToPrimitives: false, context?: Context): Record<string, Node>;
  toObject(convertToPrimitives?: boolean, context?: Context): Record<string, string | number  | boolean | Node>;
  toObject(convertToPrimitives: boolean = true, context?: Context): Record<string, string | number | boolean | Node> {
    let output = new Map<string, boolean | string | number | Node>();
    const iterateRules = (rules: Rules) => {
      for (let n of rules._getChildren(context)) {
        if (isNode(n, N.Declaration)) {
          let { name, value, important } = n as any;
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
    iterateRules(this as unknown as Rules);
    return Object.fromEntries(output);
  }

  /** @todo - Refactor? */
  _rulesSet: RulesEntry[] | undefined;
  get rulesSet(): RulesEntry[] {
    return (this._rulesSet ??= []);
  }

  registerNode(node: Node, options?: Record<string, any>, context?: Context) {
    if (isNode(node, N.Rules)) {
      const nodeOptions = (node as Rules).getCurrentOptions(context);
      // Use options if provided, otherwise use node's settings, otherwise empty
      // Then merge with node's settings to preserve any values not in options
      let optionsVisibility = options?.rulesVisibility;
      let nodeVisibility = nodeOptions.rulesVisibility ?? {};
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
      let readonly = Boolean(options?.readonly || nodeOptions.readonly);
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
      if (node.options?.setDefined && context) {
        const key = (node as any).name?.toString();
        let opts: Registries.FindOptions = {};
        opts.searchParents = true;
        opts.context = context;
        opts.start = undefined;
        // Exclude the node being registered so setDefined doesn't find itself
        opts.filter = (n: Node) => n !== node;
        let result = this.find('declaration', key, node.type as 'VarDeclaration' | 'Declaration', opts);
        if (result) {
          if (result.options?.readonly || opts.readonly) {
            throw new ReferenceError(`"${key}" is readonly`);
          }

          // Find the Rules node that contains the found declaration
          let foundRules: Rules | undefined = context
            ? getParent(result, context) as Rules | undefined
            : result.parent as Rules | undefined;

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
            if (context) {
              foundRules.splice(context, foundIndex + 1, 0, newDeclaration);
            } else {
              foundRules.splice(foundIndex + 1, 0, newDeclaration);
            }
          } else {
            // If not found in array, add at the beginning
            if (context) {
              foundRules.unshift(context, newDeclaration);
            } else {
              foundRules.unshift(newDeclaration);
            }
          }

          // Register it via registerNode to ensure it's properly indexed
          // Note: registerNode will call register('declaration', ...) which adds to registry
          // We skip setDefined processing since we already removed the flag
          foundRules.registerNode(newDeclaration, undefined, context);
        } else {
          throw new ReferenceError(`"${key}" is not defined`);
        }
      }

      this.register('declaration', node, context);
    } else if (isNode(node, N.Ruleset)) {
      // Register to 'mixin' for mixin calls
      // Always register - guard filtering happens at call time in getFunctionFromMixins
      // Note: 'ruleset' registration for extends now happens in Ruleset.preEval to the extend root's registry
      this.register('mixin', node, context);
    } else if (isNode(node, N.Mixin)) {
      this.register('mixin', node, context);
    } else if (isNode(node, N.Func)) {
      this.register('function', node, context);
    }
  }

  override push(...nodes: Node[]): void;
  override push(ctx: Context, ...nodes: Node[]): void;
  override push(...args: [Context, ...Node[]] | Node[]): void {
    const hasCtx = args.length > 0 && args[0] instanceof Context;
    const ctx = hasCtx ? args[0] as Context : undefined;
    const nodes = (hasCtx ? args.slice(1) : args) as Node[];
    // Route through _getChildren/_setChildren overlay when context is active
    if (ctx) {
      const nextValue = [...this._getChildren(ctx)];
      for (const node of nodes) {
        this.adopt(node, ctx);
        nextValue.push(node);
      }
      this._setChildren(nextValue, ctx);
      for (const node of nodes) {
        this.registerNode(node, undefined, ctx);
      }
      return;
    }
    this._setValueArray([...this.value]);
    for (const node of nodes) {
      this.adopt(node, ctx);
      (this.value as Node[]).push(node);
      this.registerNode(node, undefined, ctx);
    }
  }

  override splice(start: number, deleteCount: number, ...items: Node[]): Node[];
  override splice(ctx: Context, start: number, deleteCount: number, ...items: Node[]): Node[];
  override splice(...args: [Context, number, number, ...Node[]] | [number, number, ...Node[]]): Node[] {
    const hasCtx = args[0] instanceof Context;
    const ctx = hasCtx ? args[0] as Context : undefined;
    const [start, deleteCount, ...items] = (hasCtx ? args.slice(1) : args) as [number, number, ...Node[]];
    // Route through overlay when context is active
    if (ctx) {
      const nextValue = [...this._getChildren(ctx)];
      const removed = nextValue.splice(start, deleteCount, ...items);
      for (const item of items) {
        if (item instanceof Node) {
          this.adopt(item, ctx);
        }
      }
      this._setChildren(nextValue, ctx);
      for (const item of items) {
        if (item instanceof Node) {
          this.registerNode(item, undefined, ctx);
        }
      }
      (this as unknown as { _invalidateValueOf: () => void })._invalidateValueOf();
      return removed as Node[];
    }
    const nextValue = [...this.value];
    const removed = nextValue.splice(start, deleteCount, ...items);
    this._setValueArray(nextValue);
    for (const item of items) {
      if (item instanceof Node) {
        this.adopt(item, ctx);
        this.registerNode(item, undefined, ctx);
      }
    }
    (this as unknown as { _invalidateValueOf: () => void })._invalidateValueOf();
    return removed as Node[];
  }

  override unshift(...items: Node[]): void;
  override unshift(ctx: Context, ...items: Node[]): void;
  override unshift(...args: [Context, ...Node[]] | Node[]): void {
    const hasCtx = args.length > 0 && args[0] instanceof Context;
    const ctx = hasCtx ? args[0] as Context : undefined;
    const items = (hasCtx ? args.slice(1) : args) as Node[];
    // Route through overlay when context is active
    if (ctx) {
      for (const item of items) {
        if (item instanceof Node) {
          this.adopt(item, ctx);
        }
      }
      this._setChildren([...items, ...this._getChildren(ctx)], ctx);
      for (const item of items) {
        if (item instanceof Node) {
          this.registerNode(item, undefined, ctx);
        }
      }
      (this as unknown as { _invalidateValueOf: () => void })._invalidateValueOf();
      return;
    }
    this._setValueArray([...this.value]);
    (this.value as Node[]).unshift(...items);
    for (const item of items) {
      if (item instanceof Node) {
        this.adopt(item, ctx);
        this.registerNode(item, undefined, ctx);
      }
    }
    (this as unknown as { _invalidateValueOf: () => void })._invalidateValueOf();
  }

  at(index: number, context?: Context) {
    return atIndex(this._getChildren(context), index);
  }

  /**
   * This traverses deeply to visit all nodes, but indexes locally.
   */
  override preEval(context: Context) {
    if (!this._isPreEvaluated(context)) {
      context.depth++;
      /** @removal-target — node-copy-reduction: maybeClone → return this.
       * Registry population, child indexing, and prelude eval should
       * all work against canonical nodes + position patches. */
      let rules = this.maybeClone(context);
      // When this is the nestable at-rule wrapper (one child Ruleset(&)), do not clone so
      // inner rulesets register to the same object we push and register as extend root.
      const nestableAtRuleNames = new Set(['@media', '@supports', '@layer', '@container', '@scope']);
      const activeParent = getParent(this, context);
      const parentAtRule = activeParent?.type === 'AtRule' ? activeParent : null;
      const isNestableAtRuleBody =
        parentAtRule
        && nestableAtRuleNames.has(String((parentAtRule as any).name?.valueOf?.() ?? ''));
      const children = rules._getChildren(context);
      const first = children[0];
      const isWrapper =
        isNestableAtRuleBody
        && children.length === 1
        && isNode(first, N.Ruleset)
        && isNode((first as Ruleset).get('selector'), N.Ampersand);
      if (isWrapper) {
        rules = this;
      }
      rules._setPreEvaluated(true, context);
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
      for (let i = 0; i < children.length; i++) {
        let n = children[i]!;
        setIndex(n, i, context);
      }
      // Preserve parent when cloning - if this Rules is inside a ruleset, maintain the parent relationship
      const parent = getParent(this, context);
      if (parent && !getParent(rules, context)) {
        parent.adopt(rules, context);
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
    const processResult = serialForEach(rules._getChildren(context), (node, index) => {
      // Check if node has a static name (can be registered immediately)
      if (node.type === 'Any' && (node as any).role === 'charset') {
        /** Special case where we register the charset node immediately */
        const charsetNode = (node as Any).preEval(context);
        rules._setChildAt(index, charsetNode, context, false);
        rules.adopt(charsetNode, context);
        return;
      }
      // Nodes that don't register by name (Call, Expression, etc.) skip
      // both preEval and dynamic resolution — they're handled by the eval queue.
      if (!this._isRegisterableType(node)) {
        setIndex(node, index, context);
        return;
      }
      if (this._hasStaticName(node, context)) {
        // Pre-evaluate nodes with static names before registration
        // This ensures selectors are evaluated and keySets are available for rulesets
        const preEvald = node.preEval(context);
        if (isThenable(preEvald)) {
          return (preEvald as Promise<Node>).then((preEvaldNode) => {
            rules._setChildAt(index, preEvaldNode, context, false);
            rules.adopt(preEvaldNode, context);
            setIndex(preEvaldNode as Node, index, context);
            // After async preEval, check if it still has a static name
            if (this._hasStaticName(preEvaldNode, context)) {
              staticNodes.push(preEvaldNode);
              this._registerNodeIfEligible(rules, preEvaldNode, context);
            } else {
              dynamicNodes.push(preEvaldNode);
            }
          });
        }
        rules._setChildAt(index, preEvald as Node, context, false);
        rules.adopt(preEvald as Node, context);
        setIndex(preEvald as Node, index, context);
        const nodeToRegister = preEvald as Node;
        staticNodes.push(nodeToRegister);
        this._registerNodeIfEligible(rules, nodeToRegister, context);
      } else {
        dynamicNodes.push(node);
      }
    });

    const finish = () => {
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
  private _hasStaticName(node: Node, context?: Context): boolean {
    if (isNode(node, N.VarDeclaration)) {
      return this._isStatic(node.get('name'));
    }
    if (isNode(node, N.Mixin)) {
      // Check position-patched name: preEval may have resolved an interpolated name
      const name = node.get('name', context);
      return this._isStatic(name);
    }
    if (isNode(node, N.Declaration)) {
      return this._isStatic(node.get('name'));
    }
    if (node.type === 'StyleImport') {
      return this._isStatic((node as Node & { path: unknown }).path);
    }
    if (isNode(node, N.Ruleset)) {
      const selector: Node = (node as Ruleset).get('selector');
      if (isNode(selector, N.BasicSelector | N.CompoundSelector | N.ComplexSelector | N.SelectorList | N.Nil)) {
        return true;
      }
      if (context && isPreEvaluated(node, context)) {
        return true;
      }
      return selector.hasFlag(F_STATIC);
    }
    return node.hasFlag(F_STATIC);
  }

  /**
   * Register a node if it's eligible for registration
   */
  private _registerNodeIfEligible(rules: Rules, node: Node, context: Context) {
    if (isNode(node, N.Declaration)) {
      rules.registerNode(node, undefined, context);
    } else if (isNode(node, N.Mixin)) {
      rules.registerNode(node, undefined, context);
    } else if (isNode(node, N.Ruleset)) {
      // registerNode handles both 'mixin' and 'ruleset' registries
      rules.registerNode(node, undefined, context);
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
        rules.registerNode(resolvedNode, undefined, context);
      }
      if (isNode(resolvedNode, N.Nil) || this._hasStaticName(resolvedNode, context)) {
        resolvedNodes.push(resolvedNode);
        this._registerNodeIfEligible(rules, resolvedNode, context);
        return true; // made progress
      } else {
        stillUnresolved.push(resolvedNode);
        return false;
      }
    };

    const applyResolvedNodes = () => {
      const children = rules._getChildren(context);
      for (let i = 0; i < children.length; i++) {
        const node = children[i]!;
        const resolvedNode = resolvedNodes.find(n => n.index === node.index);
        if (resolvedNode && resolvedNode !== node) {
          rules._setChildAt(i, resolvedNode.inherit(node), context, false);
          rules.adopt(resolvedNode, context);
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
    const children = rules._getChildren(context);
    for (let i = startIndex; i < children.length; i++) {
      const node = children[i]!;

      // Always call preEval to ensure deep traversal and name resolution
      const result = node.preEval(context);
      if (isThenable(result)) {
        // Handle async preEval by returning a promise that resolves after all children
        return result.then((resolvedNode) => {
          // Update the node if preEval returned a different instance
          if (resolvedNode !== node) {
            rules._setChildAt(i, resolvedNode, context, false);
            rules.adopt(resolvedNode, context);
          }

          // Register the node after preEval (name resolution) if not already registered
          if (!isNode(node, N.VarDeclaration)) {
            rules.registerNode(resolvedNode, undefined, context);
          }

          // Continue with the rest of the children
          return this._preEvalRemainingChildren(rules, context, i + 1, saved);
        });
      }

      // Update the node if preEval returned a different instance
      if (result !== node) {
        rules._setChildAt(i, result, context, false);
        rules.adopt(result, context);
      }

      // Register the node after preEval (name resolution) if not already registered
      if (!isNode(node, N.VarDeclaration)) {
        rules.registerNode(result, undefined, context);
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
    // Check _meta.treeContext (private field) not treeContext (getter that lazily creates)
    const rulesTreeContext = (rules as any)._meta?.treeContext as TreeContext | undefined;
    if (rulesTreeContext && (!treeContext || treeContext !== rulesTreeContext)) {
      context.allRoots.push(rules);
      context.treeContext = rulesTreeContext;
      context.treeRoot = rules;
    }
    // Always set root if not set - needed for extends to work with API-created Rules
    context.root ??= rules;
    context.rulesContext = context.lookupScope ?? rules;
  }

  /** Assign depth-first document order to every Ruleset under the given Rules (single walk, source order). */
  private _assignDocumentOrderDepthFirst(
    rules: Rules,
    map: WeakMap<Ruleset, number>,
    counter: { value: number },
    context?: Context
  ): void {
    const value = rules._getChildren(context);
    if (!isArray(value)) {
      return;
    }
    for (const node of value) {
      if (isNode(node, N.Ruleset)) {
        map.set(node as Ruleset, counter.value);
        counter.value++;
      }
      const innerRules = (node as any).rules;
      if (innerRules && isNode(innerRules, N.Rules)) {
        this._assignDocumentOrderDepthFirst(innerRules as Rules, map, counter, context);
      }
    }
  }

  /** Build the evaluation queue partitioned by priority */
  private _buildEvalQueue(rules: Rules, context: Context): EvalQueueMap {
    let evalQueue: EvalQueueMap = new Map();
    for (const item of rules._getChildren(context).entries()) {
      let [idx, rule] = item;
      if (rule.index === undefined) {
        rule.index = idx;
      }
      let priority = NodeTypeToPriority.get(rule.type) ?? Priority.None;
      // Less variable-calls `@foo();` are parsed as Expression(Call(variable-ref)).
      // We *selectively* boost only those calls that "unlock mixins" (i.e. calling a variable whose
      // value is a detached ruleset containing mixin definitions). This avoids changing evaluation
      // order for regular detached rulesets like `@ruleset()` used for property blocks.
      if (priority === Priority.None && rules.treeContext?.leakyRules === true && isNode(rule, N.Expression)) {
        const inner = (rule as any).value;
        if (isNode(inner, N.Call) && isNode((inner as any).name, N.Reference)) {
          const ref = (inner as any).name;
          const refType = String(ref?.options?.type ?? '');
          if (refType === 'variable') {
            const raw = ref.key;
            const keyStr = Array.isArray(raw) ? raw.join('') : String(raw?.valueOf?.() ?? raw ?? '');
            // Only if variable exists and its value is a detached ruleset Mixin with nested Mixin definitions.
            const decl = rules.find('declaration', keyStr, 'VarDeclaration', { context }) as any;
            const val = decl?.value;
            const hasNestedMixinDefinitions =
              isNode(val, N.Mixin)
              && isNode((val as any).rules, N.Rules)
              && (val as any).rules._getChildren(context).some((n: any) => n?.type === 'Mixin');
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
              // Store in eval position: patch the parent's value array.
              {
                const children = (context.activeState.peek(rules)?._fields?.get('value') as Node[] | undefined)
                  ?? [...rules.value];
                children[idx] = result;
                context.activeState.get(rules).fields.set('value', children);
              }
              rules._setChildAt(idx, result, context, false);
              queue[q] = [idx, result];
              // If a StyleImport evaluated to Rules, register them in the parent's _rulesSet
              // so variables from the import can be found by the parent
              // Also register Rules from Call results (mixin calls) in the same way
              if (isNode(result, N.Rules)) {
                // Set the index of the imported Rules to the StyleImport's index
                // so we can compare Rules indices when determining which variable was declared later
                setIndex(result, idx, context);
                rules.adopt(result, context);
                rules.registerNode(result, {
                  rulesVisibility: result.options.rulesVisibility,
                  readonly: result.options.readonly
                }, context);
                if (result.sourceNode?.type === 'StyleImport') {
                  result.getRegistry('declaration')?.indexPendingItems();
                  result.getRegistry('mixin')?.indexPendingItems();
                }
              } else {
                // For non-Rules results, adopt them to set up parent chain
                rules.adopt(result, context);
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
  private _coalesceMergedDeclarations(rules: Rules, context?: Context): void {
    const getDeclValue = (node: Node): Node => (
      context ? getField<Node>(node, 'value', context) : (node as any).value
    );
    const getDeclImportant = (node: Node): Node | undefined => (
      context ? getField<Node | undefined>(node, 'important', context) : (node as any).important
    );
    const getDeclName = (node: Node): string => {
      const name = context ? getField<Node>(node, 'name', context) : (node as any).name;
      return String((name as any)?.valueOf?.() ?? name);
    };
    const getDeclAssign = (node: Node): string => {
      const options = context
        ? getField<Record<string, unknown> | undefined>(node, 'options', context)
        : node.options;
      return String(options?.normalizedFromAssign ?? '');
    };
    const setDeclField = (node: Node, key: 'value' | 'important', value: Node | undefined): void => {
      if (context) {
        setField(node, key, value, context);
        return;
      }
      node.setData(key, value);
    };
    const removeVisibleFlag = (node: Node): void => {
      if (context) {
        node._removeFlag(F_VISIBLE, context);
        return;
      }
      node.removeFlag(F_VISIBLE);
    };
    const isMergedAssign = (assign: unknown): boolean => (
      assign === '+:' || assign === '&,:' || assign === '&_:'
    );
    const isDeclarationOnlyRules = (node: Node): node is Rules => (
      isNode(node, N.Rules)
      && node._getChildren(context).length > 0
      && node._getChildren(context).every(child => isNode(child, N.Declaration | N.Comment))
    );
    const composeMergedValue = (decl: Node, prior: Node, assign: string): void => {
      if (!isNode(decl, N.Declaration) || !isNode(prior, N.Declaration)) {
        return;
      }
      const priorValue = getDeclValue(prior);
      const nextValue = getDeclValue(decl);
      setDeclField(decl, 'value', assign === '&_:'
        ? spaced([priorValue, nextValue])
        : new List([priorValue, nextValue]));
      if (!getDeclImportant(decl) && getDeclImportant(prior)) {
        setDeclField(decl, 'important', getDeclImportant(prior));
      }
    };
    const normalizeMergedDeclarationValue = (node: Node): void => {
      if (!isNode(node, N.Declaration)) {
        return;
      }
      const current = getDeclValue(node);
      if (!isNode(current, N.List) || current.get('value').length === 0) {
        return;
      }
      const [first, ...rest] = current.get('value');
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
          || (isNode(first, N.List) && first.get('value').length === 0)
          || firstIsEmptyString
        )
      );
      if (!isEmptyPlaceholder) {
        return;
      }
      if (rest.length === 0) {
        setDeclField(node, 'value', new Nil());
        return;
      }
      if (rest.length === 1) {
        setDeclField(node, 'value', rest[0]!);
        return;
      }
      setDeclField(node, 'value', new List(rest));
    };

    const lastVisibleByName = new Map<string, Node>();
    const mergedAnchorByName = new Map<string, Node>();
    const stream: Node[] = [];

    for (const node of rules._getChildren(context)) {
      if (isNode(node, N.Declaration)) {
        stream.push(node);
        continue;
      }
      if (isDeclarationOnlyRules(node)) {
        for (const child of node._getChildren(context)) {
          if (isNode(child, N.Declaration)) {
            stream.push(child);
          }
        }
      }
    }

    for (const node of stream) {
      if (!isNode(node, N.Declaration)) {
        continue;
      }
      const name = getDeclName(node);
      const assign = getDeclAssign(node);
      const merged = isMergedAssign(assign);

      if (!merged) {
        mergedAnchorByName.delete(name);
        if (node.visible) {
          lastVisibleByName.set(name, node);
        }
        continue;
      }
      normalizeMergedDeclarationValue(node);

      const prior = lastVisibleByName.get(name);
      if (
        prior
        && prior !== node
        && (
          context
            ? getParent(prior, context) !== getParent(node, context)
            : prior.parent !== node.parent
        )
      ) {
        composeMergedValue(node, prior, assign);
      }

      const existingAnchor = mergedAnchorByName.get(name);
      if (existingAnchor && existingAnchor !== node && isNode(existingAnchor, N.Declaration)) {
        // @todo — copy(true) was used here for comment suppression (stripping
        // pre/post comments from merged values). Need a position-aware
        // alternative: either a serialization-time comment suppression flag
        // or field patches on pre/post.
        setDeclField(existingAnchor, 'value', getDeclValue(node));
        if (!getDeclImportant(existingAnchor) && getDeclImportant(node)) {
          setDeclField(existingAnchor, 'important', getDeclImportant(node));
        }
        removeVisibleFlag(node);
        if (existingAnchor.visible) {
          lastVisibleByName.set(name, existingAnchor);
        }
        continue;
      }

      mergedAnchorByName.set(name, node);
      if (node.visible) {
        lastVisibleByName.set(name, node);
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
  private _normalizeCallDeclarationRulesOrder(rules: Rules, context?: Context): void {
    const children = rules._getChildren(context);
    const firstNestedIdx = children.findIndex(n => isNode(n, N.Ruleset | N.AtRule));
    if (firstNestedIdx < 0) {
      return;
    }
    const beforeNested = children.slice(0, firstNestedIdx);
    const afterNested = children.slice(firstNestedIdx);
    const shouldMove = (n: Node) => {
      const sourceParent = context
        ? getSourceParent(n, context)
        : n.sourceParent;
      if (
        !isNode(n, N.Rules)
        || !isNode(sourceParent, N.Call)
        || n._getChildren(context).length === 0
        || !n._getChildren(context).every(child => isNode(child, N.Declaration | N.Comment))
      ) {
        return false;
      }
      const sourceName = (sourceParent as any).name;
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
    rules._setChildren([...beforeNested, ...moved, ...remainder], context, false);
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
    if (isEvaluated(rules, context)) {
      return { rules, rulesToHoist: false };
    }
    if (rules === context.root) {
      const map = new WeakMap<Ruleset, number>();
      context.documentOrderByRuleset = map;
      this._assignDocumentOrderDepthFirst(rules, map, { value: 0 }, context);
    }
    const evalQueue = this._buildEvalQueue(rules, context);
    const maybeHoist = this._evaluateQueue(rules, evalQueue, context);
    if (isThenable(maybeHoist)) {
      return (maybeHoist as Promise<boolean>).then((rulesToHoist) => {
        this._normalizeCallDeclarationRulesOrder(rules, context);
        this._coalesceMergedDeclarations(rules, context);
        return {
          rules,
          rulesToHoist
        };
      });
    }
    this._normalizeCallDeclarationRulesOrder(rules, context);
    this._coalesceMergedDeclarations(rules, context);
    return { rules, rulesToHoist: maybeHoist as boolean };
  }

  override evalNode(context: Context): MaybePromise<this> {
    const saved = this._snapshotContext(context);
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
      if (context.rulesEvalStack[context.rulesEvalStack.length - 1] === (this.sourceNode as Rules)) {
        context.rulesEvalStack.pop();
      }
      context.depth--;
    };
    let pipeResult: MaybePromise<this>;
    try {
      pipeResult = pipe(
        () => {
          this._setupContextForRules(context, this);
          // Run preEval first if not yet run (e.g. when jess compile() calls eval() without preEval).
          // preEval registers the root and all nested rulesets so extend lookups find targets in child roots (e.g. .ma inside @media).
          const runPreEvalIfNeeded = (rules: Rules): MaybePromise<Rules> => {
            if (rules._isPreEvaluated(context)) {
              return rules;
            }
            const result = rules.preEval(context);
            return isThenable(result) ? (result as Promise<Rules>) : result;
          };
          const rulesAfterPreEval = runPreEvalIfNeeded(this);
          const afterPreEval = (rules: Rules) => {
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
            for (const entry of rules.rulesSet) {
              if (entry.readonly) {
                const importedVars = Registries
                  .getDirectDeclarationsByKey(entry.node, undefined, context)
                  .filter((decl): decl is VarDeclaration => isNode(decl, N.VarDeclaration));
                for (const decl of importedVars) {
                  const key = decl.get('name').toString();
                  const currentDeclarations = Registries.getDirectDeclarationsByKey(rules, key, context);
                  for (const currentDecl of currentDeclarations) {
                    if (isNode(currentDecl, N.VarDeclaration) && !currentDecl.options?.setDefined) {
                      // Only throw if the variable is a direct child of the Rules node (same level)
                      // Nested variables (e.g., inside rulesets) are allowed to shadow
                      if (getParent(currentDecl, context) === rules) {
                        throw new ReferenceError(`"${key}" is readonly`);
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
 * Returns a plain JS function for calling a set of mixins
 *
 * This is in the same file as Rules to avoid circular dependencies.
 *
 * @note this will be called as a result after a mixin find is executed.
 */
export function getFunctionFromMixins(mixins: MixinEntry | MixinEntry[]) {
  let mixinArr = isArray(mixins) ? mixins : [mixins];
  /**
   * This will be called by a mixin call or by JavaScript
   *
   * @note - Mixins resolve to async functions because they
   * can contain dynamic imports.
   */
  async function returnFunc(this: unknown, ...args: any[]): Promise<Rules | Record<string, string>>;
  async function returnFunc(this: Context, ...args: any[]): Promise<Rules>;
  async function returnFunc(this: Context | unknown, ...args: any[]) {
    // When called via callWithContext, 'this' is functionThis, not Context
    // We need to extract the context from functionThis or use a fallback
    let thisContext: Context;

    if (this instanceof Context) {
      thisContext = this;
    } else if (this && typeof this === 'object' && 'context' in this) {
      // This is functionThis from callWithContext
      thisContext = (this as any).context;
    } else {
      thisContext = new Context();
    }
    let caller = thisContext.caller;
    const callerSourceNode = (caller as any)?.name instanceof Node
      ? (caller as any).name
      : caller;
    let sourceParent = callerSourceNode
      ? getSourceParent(callerSourceNode, thisContext)
      : undefined;

    const nodeArgs = await evaluateMixinArgs(args, caller, thisContext);
    const mixinCandidates = await matchMixinCandidates(mixinArr, nodeArgs, caller, sourceParent, thisContext);
    const { evalCandidates, hasDefault } = filterAndSortMixinEvalCandidates(mixinCandidates, thisContext);

    const outputRules: Rules[] = [];
    const candidateOutputOpts: EvaluateCandidateOutputOptions = {
      sourceParent,
      restrictMixinOutputLookup: thisContext.leakyRules !== true,
      outputRules,
      getCandidateParent: node => getCandidateParent(node, thisContext)
    };

    const output = await dispatchMixinEvalCandidates({
      evalCandidates,
      hasDefault,
      nodeArgs,
      sourceParent,
      caller,
      restrictMixinOutputLookup: candidateOutputOpts.restrictMixinOutputLookup,
      outputRules,
      getCandidateParent: candidateOutputOpts.getCandidateParent,
      evaluateCandidateOutput: (candidate, rules, outerRules, params) =>
        evaluateCandidateOutput(candidate, rules, outerRules, params, thisContext, candidateOutputOpts)
    }, thisContext);

    return finalizeMixinInvocationReturn(output, this instanceof Context ? this : thisContext);
  }

  return returnFunc;
}

/**
 * Direct mixin invocation — calls dispatch primitives without the
 * getFunctionFromMixins → callWithContext → returnFunc indirection.
 *
 * The result is already fully evaluated (each candidate's body was
 * evaluated under its own per-call EvalState). Callers must NOT
 * re-evaluate the result.
 */
export async function evalMixinDirect(
  context: Context,
  mixins: MixinEntry | MixinEntry[],
  args: List<Node> | undefined
): Promise<Rules | Nil> {
  const mixinArr = isArray(mixins) ? mixins : [mixins];
  const caller = context.caller;
  const callerSourceNode = caller && isNode(caller, N.Call) && caller.get('name') instanceof Node
    ? caller.get('name')
    : caller;
  const sourceParent = callerSourceNode
    ? getSourceParent(callerSourceNode as Node, context)
    : undefined;

  const nodeArgs = await evaluateMixinArgs(
    args ? [...args.get('value', context)] : [],
    caller,
    context
  );
  const mixinCandidates = await matchMixinCandidates(
    mixinArr, nodeArgs, caller, sourceParent, context
  );
  const { evalCandidates, hasDefault } = filterAndSortMixinEvalCandidates(
    mixinCandidates, context
  );

  const outputRules: Rules[] = [];
  const candidateOutputOpts: EvaluateCandidateOutputOptions = {
    sourceParent,
    restrictMixinOutputLookup: context.leakyRules !== true,
    outputRules,
    getCandidateParent: node => getCandidateParent(node, context)
  };

  const output = await dispatchMixinEvalCandidates({
    evalCandidates,
    hasDefault,
    nodeArgs,
    sourceParent,
    caller,
    restrictMixinOutputLookup: candidateOutputOpts.restrictMixinOutputLookup,
    outputRules,
    getCandidateParent: candidateOutputOpts.getCandidateParent,
    evaluateCandidateOutput: (candidate, rules, outerRules, params) =>
      evaluateCandidateOutput(candidate, rules, outerRules, params, context, candidateOutputOpts)
  }, context);

  return finalizeMixinInvocationReturn(output, context) as Rules | Nil;
}
