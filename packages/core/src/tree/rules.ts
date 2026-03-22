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
import { comparePosition } from './util/compare.js';
import { cast } from './util/cast.js';
import { type Ruleset } from './ruleset.js';
import { type Mixin } from './mixin.js';
import type { Selector } from './selector.js';
import { spaced, Sequence } from './sequence.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';

import { atIndex, isPlainObject } from './util/collections.js';
import type { Condition } from './condition.js';
import { Bool } from './bool.js';
import * as Registries from './util/registry-utils.js';
import { processExtends } from './util/extend-roots.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import { Nil } from './nil.js';
import { VarDeclaration } from './declaration-var.js';
import type { Declaration } from './declaration.js';
import { Any } from './any.js';
import { List } from './list.js';
import { indent, normalizeIndent } from './util/serialize-helper.js';
import { freezeChildren } from './util/cloning.js';
import {
  sessionGetChildren,
  sessionGetDependency,
  sessionGetField,
  sessionGetParent,
  sessionGetSourceParent,
  sessionMergeDependencies,
  sessionPatchField,
  sessionSetChildren,
  sessionSetChildAt,
  sessionSetDependency,
  sessionSetIndex,
  sessionSetParent,
  sessionSetSourceParent
} from './util/session-helpers.js';
import { EvalSession } from '../eval-session.js';
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
      ? sessionGetField<RulesOptions & NodeOptions & {
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
    if (context?.session && this === this.sourceNode) {
      sessionPatchField(this, 'options', options, context);
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

    if (ctx?.session?.resetEvalState) {
      const parent = sessionGetParent(this, ctx);
      if (parent) {
        sessionSetParent(newRules, parent, ctx);
        (newRules as unknown as { parent?: Node }).parent = undefined;
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
   * Lazily create registries for types as needed.
   */
  register(
    type: 'ruleset' | 'declaration' | 'mixin' | 'function',
    node: Node,
    context?: Context
  ) {
    if (type === 'function') {
      let registry = this.functionRegistry;
      if (!registry) {
        registry = new Registries.FunctionRegistry(this);
        this.functionRegistry = registry;
      }
      return registry.add(node as any);
    }

    if (Registries.registerSessionNode(this, type, node, context)) {
      return;
    }

    return Registries.registerCanonicalNode(this, type, node);
  }

  getRegistry(type: 'ruleset', context?: Context): Registries.RulesetRegistry;
  getRegistry(type: 'declaration', context?: Context): Registries.DeclarationRegistry;
  getRegistry(type: 'mixin', context?: Context): Registries.MixinRegistry;
  getRegistry(type: 'function', context?: Context): Registries.FunctionRegistry;
  getRegistry(type: 'ruleset' | 'declaration' | 'mixin' | 'function', context?: Context): Registries.RulesetRegistry | Registries.DeclarationRegistry | Registries.MixinRegistry | Registries.FunctionRegistry;
  getRegistry(type: 'ruleset' | 'declaration' | 'mixin' | 'function', context?: Context) {
    if (type === 'function') {
      this.functionRegistry ??= new Registries.FunctionRegistry(this);
      return this.functionRegistry;
    }

    Registries.syncRegistryCache(this, context);
    let className = `${type.charAt(0).toUpperCase()}${type.slice(1)}` as Capitalize<typeof type>;
    let RegistryClass = Registries[`${className}Registry`];
    return new RegistryClass(this, context);
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
    let registry = this.getRegistry(type, options.context);
    return (registry as any).find(keys, filterType, options);
  }

  findSessionPatchedFunction(
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
        rules = sessionGetParent(rules, context) as Rules | undefined;
        if (findRoot && rules?.type === 'Rules' && sessionGetParent(rules, context) === undefined) {
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

  constructor(
    value: readonly Node[],
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
    const normalized = (value ?? []) as Node[];
    super(normalized, mergedOptions, location, treeContext);
    this._setValueArray(normalized);
    for (const child of normalized) {
      if (child instanceof Node) {
        this.adopt(child);
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
      ? sessionGetChildren(this, context)
      : this.value;
  }

  private _setChildren(value: readonly Node[], context?: Context, markDirty: boolean = true): void {
    if (context?.session && !context.session.resetEvalState) {
      sessionSetChildren(this, value, context, { markDirty });
      return;
    }
    this.setData([...value]);
  }

  private _setChildAt(index: number, node: Node, context?: Context, markDirty: boolean = true): void {
    if (context?.session && !context.session.resetEvalState) {
      sessionSetChildAt(this, index, node, context, { markDirty });
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
    this._emitRulesBody(options);
    return w.getSince(mark);
  }

  /** All rules, with nested rules flattened */
  flatRules(visibleOnly: boolean = false, context?: Context) {
    const finalRules: Node[] = [];
    const iterateRules = (rules: Rules) => {
      for (let n of rules._getChildren(context)) {
        if (isNode(n, N.Rules)) {
          // Preserve reference-mode Rules as containers so the serializer
          // can detect the referenceMode flag and suppress output.
          if ((n.options as RulesOptions)?.referenceMode === true) {
            finalRules.push(n);
          } else {
            iterateRules(n);
          }
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
      if (node.options?.setDefined) {
        // Skip setDefined logic if we're currently indexing to avoid recursive calls
        if (Registries.isRegistryIndexing(this)) {
          // We'll handle setDefined after indexing is complete
          return;
        }

        let key = (node as any).name?.toString();
        /** Don't set within sibling rules */
        let opts: Registries.FindOptions = {};
        opts.searchParents = true;
        opts.context = context;
        // Don't use start when searching parents - we want to find variables in parent regardless of position
        // start is only relevant for finding variables before the current node in the same Rules
        opts.start = undefined;
        // node.type is 'VarDeclaration' or 'Declaration', use it directly as filterType
        let result = this.find('declaration', key, node.type as 'VarDeclaration' | 'Declaration', opts);
        if (result) {
          if (result.options?.readonly || opts.readonly) {
            throw new ReferenceError(`"${key}" is readonly`);
          }

          // Find the Rules node that contains the found declaration
          let foundRules: Rules | undefined = context
            ? sessionGetParent(result, context) as Rules | undefined
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
    if (!(ctx?.session && !ctx.session.resetEvalState)) {
      this._setValueArray([...this.value]);
      for (const node of nodes) {
        this.adopt(node, ctx);
        (this.value as Node[]).push(node);
        this.registerNode(node, undefined, ctx);
      }
      return;
    }
    const nextValue = [...this._getChildren(ctx)];
    for (const node of nodes) {
      this.adopt(node, ctx);
      nextValue.push(node);
    }
    this._setChildren(nextValue, ctx);
    for (const node of nodes) {
      this.registerNode(node, undefined, ctx);
    }
  }

  override splice(start: number, deleteCount: number, ...items: Node[]): Node[];
  override splice(ctx: Context, start: number, deleteCount: number, ...items: Node[]): Node[];
  override splice(...args: [Context, number, number, ...Node[]] | [number, number, ...Node[]]): Node[] {
    const hasCtx = args[0] instanceof Context;
    const ctx = hasCtx ? args[0] as Context : undefined;
    const [start, deleteCount, ...items] = (hasCtx ? args.slice(1) : args) as [number, number, ...Node[]];
    if (!(ctx?.session && !ctx.session.resetEvalState)) {
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

  override unshift(...items: Node[]): void;
  override unshift(ctx: Context, ...items: Node[]): void;
  override unshift(...args: [Context, ...Node[]] | Node[]): void {
    const hasCtx = args.length > 0 && args[0] instanceof Context;
    const ctx = hasCtx ? args[0] as Context : undefined;
    const items = (hasCtx ? args.slice(1) : args) as Node[];
    if (!(ctx?.session && !ctx.session.resetEvalState)) {
      this._setValueArray([...this.value]);
      (this.value as Node[]).unshift(...items);
      for (const item of items) {
        if (item instanceof Node) {
          this.adopt(item, ctx);
          this.registerNode(item, undefined, ctx);
        }
      }
      (this as unknown as { _invalidateValueOf: () => void })._invalidateValueOf();
      return;
    }
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
      let rules = this.maybeClone(context);
      // When this is the nestable at-rule wrapper (one child Ruleset(&)), do not clone so
      // inner rulesets register to the same object we push and register as extend root.
      const nestableAtRuleNames = new Set(['@media', '@supports', '@layer', '@container', '@scope']);
      const activeParent = sessionGetParent(this, context);
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
        && isNode((first as Ruleset).selector, N.Ampersand);
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
        sessionSetIndex(n, i, context);
      }
      // Preserve parent when cloning - if this Rules is inside a ruleset, maintain the parent relationship
      const parent = sessionGetParent(this, context);
      if (parent && !sessionGetParent(rules, context)) {
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
        sessionSetIndex(node, index, context);
        return;
      }
      if (this._hasStaticName(node)) {
        // Pre-evaluate nodes with static names before registration
        // This ensures selectors are evaluated and keySets are available for rulesets
        const preEvald = node.preEval(context);
        if (isThenable(preEvald)) {
          return (preEvald as Promise<Node>).then((preEvaldNode) => {
            rules._setChildAt(index, preEvaldNode, context, false);
            rules.adopt(preEvaldNode, context);
            sessionSetIndex(preEvaldNode as Node, index, context);
            // After async preEval, check if it still has a static name
            if (this._hasStaticName(preEvaldNode)) {
              staticNodes.push(preEvaldNode);
              this._registerNodeIfEligible(rules, preEvaldNode, context);
            } else {
              dynamicNodes.push(preEvaldNode);
            }
          });
        }
        rules._setChildAt(index, preEvald as Node, context, false);
        rules.adopt(preEvald as Node, context);
        sessionSetIndex(preEvald as Node, index, context);
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
  private _hasStaticName(node: Node): boolean {
    if (isNode(node, N.VarDeclaration)) {
      const name = (node as any).name;
      return this._isStatic(name);
    }
    if (isNode(node, N.Mixin)) {
      const name = (node as any).name;
      return this._isStatic(name);
    }
    if (isNode(node, N.Declaration)) {
      const name = (node as any).name;
      return this._isStatic(name);
    }
    if (node.type === 'StyleImport') {
      const path = (node as any).path;
      return this._isStatic(path);
    }
    if (isNode(node, N.Ruleset)) {
      const selector = (node as any).selector;
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
    context.rulesContext = rules;
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
      let [, rule] = item;
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
              rules._setChildAt(idx, result, context, false);
              queue[q] = [idx, result];
              // If a StyleImport evaluated to Rules, register them in the parent's _rulesSet
              // so variables from the import can be found by the parent
              // Also register Rules from Call results (mixin calls) in the same way
              if (isNode(result, N.Rules)) {
                // Set the index of the imported Rules to the StyleImport's index
                // so we can compare Rules indices when determining which variable was declared later
                sessionSetIndex(result, idx, context);
                rules.adopt(result, context);
                rules.registerNode(result, {
                  rulesVisibility: result.options.rulesVisibility,
                  readonly: result.options.readonly
                }, context);
                if (result.sourceNode?.type === 'StyleImport') {
                  result.getRegistry('declaration').indexPendingItems();
                  result.getRegistry('mixin').indexPendingItems();
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
    const useSessionFields = Boolean(context?.session && !context.session.resetEvalState);
    const getDeclValue = (node: Node): Node => (
      useSessionFields && context
        ? sessionGetField<Node>(node, 'value', context)
        : (node as any).value
    );
    const getDeclImportant = (node: Node): Node | undefined => (
      useSessionFields && context
        ? sessionGetField<Node | undefined>(node, 'important', context)
        : (node as any).important
    );
    const getDeclName = (node: Node): string => {
      const name = useSessionFields && context
        ? sessionGetField<Node>(node, 'name', context)
        : (node as any).name;
      return String((name as any)?.valueOf?.() ?? name);
    };
    const getDeclAssign = (node: Node): string => {
      const options = useSessionFields && context
        ? sessionGetField<Record<string, unknown> | undefined>(node, 'options', context)
        : node.options;
      return String(options?.normalizedFromAssign ?? '');
    };
    const setDeclField = (node: Node, key: 'value' | 'important', value: Node | undefined): void => {
      if (useSessionFields && context) {
        sessionPatchField(node, key, value, context);
        return;
      }
      node.setData(key, value);
    };
    const removeVisibleFlag = (node: Node): void => {
      if (useSessionFields && context) {
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
      const priorValue = getDeclValue(prior).copy(true, freezeChildren);
      const nextValue = getDeclValue(decl).copy(true, freezeChildren);
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
        setDeclField(node, 'value', new Nil());
        return;
      }
      if (rest.length === 1) {
        setDeclField(node, 'value', rest[0]!.copy(true, freezeChildren));
        return;
      }
      setDeclField(node, 'value', new List(rest.map(item => item.copy(true, freezeChildren))));
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
          useSessionFields && context
            ? sessionGetParent(prior, context) !== sessionGetParent(node, context)
            : prior.parent !== node.parent
        )
      ) {
        composeMergedValue(node, prior, assign);
      }

      const existingAnchor = mergedAnchorByName.get(name);
      if (existingAnchor && existingAnchor !== node && isNode(existingAnchor, N.Declaration)) {
        setDeclField(existingAnchor, 'value', getDeclValue(node).copy(true));
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
        ? sessionGetSourceParent(n, context)
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
    if (rules.evaluated) {
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
                  const key = decl.name.toString();
                  const currentDeclarations = Registries.getDirectDeclarationsByKey(rules, key, context);
                  for (const currentDecl of currentDeclarations) {
                    if (isNode(currentDecl, N.VarDeclaration) && !currentDecl.options?.setDefined) {
                      // Only throw if the variable is a direct child of the Rules node (same level)
                      // Nested variables (e.g., inside rulesets) are allowed to shadow
                      if (sessionGetParent(currentDecl, context) === rules) {
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
    const mixinLength = mixinArr.length;
    let mixinCandidates: MixinEntry[] = [];
    let evalCandidates: MixinEntry[];
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
    const getSessionRulesParent = (node: Node | undefined): Rules | undefined => {
      let possibleRules = node ? sessionGetParent(node, thisContext) : undefined;
      while (possibleRules && possibleRules.type !== 'Rules') {
        possibleRules = sessionGetParent(possibleRules, thisContext);
      }
      return possibleRules as Rules | undefined;
    };
    const getSessionSourceRulesParent = (node: Node | undefined): Rules | undefined => {
      let current = node;
      let sourceParent = current ? sessionGetSourceParent(current, thisContext) : undefined;
      while (current && !sourceParent) {
        current = sessionGetParent(current, thisContext);
        sourceParent = current ? sessionGetSourceParent(current, thisContext) : undefined;
      }
      return sourceParent ? getSessionRulesParent(sourceParent) : undefined;
    };
    const callerSourceNode = (caller as any)?.name instanceof Node
      ? (caller as any).name
      : caller;
    let sourceParent = callerSourceNode
      ? sessionGetSourceParent(callerSourceNode, thisContext)
      : undefined;
    const getCandidateParent = (node: Node): Node => {
      const parent = sessionGetParent(node, thisContext);
      if (!parent) {
        throw new ReferenceError(`${node.type} candidate must have a parent during mixin evaluation`);
      }
      return parent;
    };
    let nodeArgs: Node[] = [];
    const savedRulesContext = thisContext.rulesContext;
    const argEvalRulesContext = getSessionRulesParent(caller) ?? getSessionSourceRulesParent(callerSourceNode) ?? savedRulesContext;
    thisContext.rulesContext = argEvalRulesContext;
    try {
      for (let arg of args) {
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
            const clonedValue = (cloned as VarDeclaration).value;
            if (clonedValue instanceof Node) {
              const evaldValue = await clonedValue.clonedEval(thisContext);
              evaldValue.frozen = true;
              (cloned as VarDeclaration).setData('value', evaldValue);
            }
            cloned.frozen = true;
            nodeArgs.push(cloned);
            continue;
          }
          try {
            const evald = await arg.clonedEval(thisContext);
            if (evald.type === 'Rest') {
              let restValue = (evald as any).value;
              // Rest's sync evalNode may not resolve an async inner Reference.
              // Explicitly evaluate the inner node if it's still a Reference.
              if (isNode(restValue as Node) && !isNode(restValue as Node, N.Sequence | N.List)) {
                restValue = await (restValue as Node).eval(thisContext);
              }
              if (isNode(restValue, N.Sequence) || isNode(restValue, N.List)) {
                for (const restArg of (restValue as any).value) {
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
      const items = (node as any).value as Node[];
      if (items.length > 0) {
        items[0]!.pre = 0;
      }
      for (const item of items) {
        if (isNode(item, N.List | N.Sequence)) {
          normalizeBoundLeadingItemWhitespace(item as Node);
        }
      }
    };
    const copyDependency = (source: Node, target: Node): void => {
      const dependency = sessionGetDependency(source, thisContext);
      if (dependency?.dependsOn && dependency.dependsOn.size > 0) {
        sessionSetDependency(target, {
          dependsOn: new Set(dependency.dependsOn),
          sourceExpr: dependency.sourceExpr
        }, thisContext);
      }
    };
    const bindingSourceParent = caller ?? sourceParent;
    for (let i = 0; i < mixinLength; i++) {
      let mixin = mixinArr[i]!;
      let isPlainRule = isNode(mixin, N.Rules);
      let paramLength = isPlainRule ? 0 : (mixin as Mixin).params?.length ?? 0;
      if (!paramLength) {
        /** Exit early if args were passed in, but no args are possible */
        if (args.length) {
          continue;
        }
        mixinCandidates.push(mixin);
      } else {
        /** The mixin has parameters, so let's check args to see if there's a match */
        let params = (mixin as Mixin).params!.copy(true);
        const hasRestParamOriginal = (mixin as Mixin).params!.value.some(p => p.type === 'Rest');
        const maxPositionalArgs = hasRestParamOriginal ? Number.POSITIVE_INFINITY : params.length;
        let positions = params.length;
        let requiredPositions = 0;
        for (let param of params.value) {
          if (isNode(param, N.VarDeclaration)) {
            if ((param as any).value instanceof Nil) {
              requiredPositions++;
            }
          } else if (isNode(param, N.Any) && param.role === 'property') {
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
          let argValue: Node;
          if (isNode(arg, N.VarDeclaration)) {
            param = params.value.find(
              (p) => {
                if (isNode(p, N.VarDeclaration)) {
                  return (p as any).name.valueOf() === (arg as any).name.valueOf();
                }
                if (isNode(p, N.Any) && p.role === 'property') {
                  return p.valueOf() === (arg as any).name.valueOf();
                }
                return false;
              }
            );
            if (param) {
              argValue = (arg as any).value;
            } else {
              match = false;
              break;
            }
          } else {
            param = params.value[i];
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
            const boundValue = argValue.copy(true, freezeChildren);
            boundValue.frozen = true;
            if (bindingSourceParent) {
              sessionSetSourceParent(boundValue, bindingSourceParent, thisContext);
            }
            normalizeBoundLeadingItemWhitespace(boundValue);
            copyDependency(argValue, boundValue);
            param.setData('value', boundValue);
          } else if (isNode(param, N.Any) && param.role === 'property') {
            // Convert Any with role: 'property' to VarDeclaration for registration
            const boundValue = argValue.copy(true, freezeChildren);
            boundValue.frozen = true;
            if (bindingSourceParent) {
              sessionSetSourceParent(boundValue, bindingSourceParent, thisContext);
            }
            normalizeBoundLeadingItemWhitespace(boundValue);
            copyDependency(argValue, boundValue);
            const varDecl = new VarDeclaration({
              name: param as Any<'property'>,
              value: boundValue
            }, { paramVar: true });
            params.setData(i, varDecl);
          } else if (param.type === 'Rest') {
            /** We assume that the rest args are values */
            const rest = nodeArgs.slice(argPos).map((restArg) => {
              const cloned = restArg.copy(true, freezeChildren);
              cloned.frozen = true;
              copyDependency(restArg, cloned);
              return cloned;
            });
            const restValue = new Sequence(rest);
            const dependency = sessionMergeDependencies(rest, thisContext);
            if (dependency?.dependsOn && dependency.dependsOn.size > 0) {
              sessionSetDependency(restValue, {
                dependsOn: new Set(dependency.dependsOn),
                sourceExpr: dependency.sourceExpr
              }, thisContext);
            }
            /** Create a new variable with the rest name */
            const restVarDecl = new VarDeclaration({
              name: new Any((param as any).value ? `${(param as any).value}` : `rest${i}`, { role: 'property' }) as Any<'property'>,
              value: restValue
            });
            params.setData(i, restVarDecl);
            /** Check a pattern-matching node */
          } else {
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
        if (nodeArgs.length > 1 && params.value.length === 1 && requiredPositions === 1) {
          // Less should not match single required-parameter overloads against extra positional args.
          continue;
        }
        if (match) {
          /** Make a shallow copy to attach our resolved params (w/ args) */
          let originalMixin = mixin;
          mixin = mixin.copy();
          getCandidateParent(originalMixin as unknown as Node).adopt(mixin);
          (mixin as Mixin).setData('params', params);
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
        const callName = String((node as any).name?.valueOf?.() ?? (node as any).name ?? '');
        if (callName === 'default' || callName === '??') {
          return true;
        }
      }
      const value = (node as any).value;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isNode(item) && guardContainsDefault(item)) {
            return true;
          }
        }
        return false;
      }
      if (isPlainObject(value)) {
        for (const item of Object.values(value)) {
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
      let current: Node | undefined = sessionGetParent(node, thisContext);
      while (current) {
        if (isNode(current, N.Ruleset)) {
          const guardNode = (current as Ruleset).guard;
          if (guardNode instanceof Nil) {
            return true;
          }
        }
        current = sessionGetParent(current, thisContext);
      }
      return false;
    };
    evalCandidates = mixinCandidates
      .filter((candidate) => {
        const inStack = thisContext.rulesEvalStack.includes((candidate as any).rules.sourceNode as Rules);
        const blockedByFailedGuardAncestor = hasFailedGuardAncestor(candidate as unknown as Node);
        return !inStack && !blockedByFailedGuardAncestor;
      })
      .map<MixinEntry>(
        (candidate) => {
          const hasDefaultGuard = Boolean(candidate.options?.hasDefault) || guardContainsDefault((candidate as any).guard as unknown as Node | undefined);
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
    const restrictMixinOutputLookup = thisContext.leakyRules !== true;
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

      try {
        let newRules: Rules;
        if (!outerRules) {
          sessionSetParent(rules, getCandidateParent(candidate as unknown as Node), thisContext);
          newRules = await rules.eval(thisContext);
        } else {
          // Evaluate in the wrapper scope so params are visible, but preserve the wrapper's
          // rulesVisibility (it keeps VarDeclaration public). Overwriting visibility here can
          // hide param vars from registry-based lookup.
          // Shallow-clone each child before pushing so canonical parents
          // aren't corrupted. The clones get parent = outerRules from push's adopt.
          for (const child of rules.value) {
            outerRules.push(thisContext, (child as Node).clone(false, undefined, thisContext));
          }
          newRules = await outerRules.eval(thisContext);
        }
        sessionSetSourceParent(newRules, sourceParent, thisContext);
        sessionSetParent(newRules, getCandidateParent(candidate as unknown as Node), thisContext);
        // Rules should have index from eval, but ensure it matches candidate for sorting
        newRules.index = candidate.index;

        // Visibility should be preserved by Rules.eval - no need to set it explicitly here
        // The eval'd rules should already have their nodes registered
        // Ensure the registry is indexed before checking
        // Mark output Rules as mixin output - accessible only when lookup has a target
        newRules.options.isMixinOutput = restrictMixinOutputLookup;
        if (thisContext.treeContext?.file) {
          /**
           * NOTE (debug policy):
           * `hasParamVar` / `hasNestedMixin` visibility branching was removed and
           * should NOT be reintroduced.
           *
           * If this causes regressions, fix lookup/parenting behavior instead:
           * - declaration/mixin registry traversal semantics
           * - sourceParent/rulesParent/sourceRulesParent propagation
           *
           * Do not solve those regressions by adding new visibility heuristics based on
           * "contains param vars" or "contains nested mixins".
           */
          newRules.options.rulesVisibility ??= {};
          newRules.options.rulesVisibility.VarDeclaration = 'private';
        }
        outputRules.push(newRules);
      } catch (error) {
        // If recursion was detected (ReferenceError), skip this candidate
        // This allows other candidates to still match
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
      }
    };

    const prevMixinSession = thisContext.session;
    if (!prevMixinSession) {
      thisContext.session = new EvalSession({ resetEvalState: true });
    }

    for (let candidate of evalCandidates) {
      if (isNode(candidate, N.Ruleset)) {
        // For Rulesets, guard was already evaluated at definition time in Ruleset.evalNode
        // guard === undefined means passed, guard instanceof Nil means failed
        const rulesetGuard = (candidate as Ruleset).guard;
        if (rulesetGuard instanceof Nil) {
          // Guard failed at definition time - skip this ruleset
          continue;
        }
        const candidateRules = (candidate as Ruleset).rules;
        const sourceRules = getRootSourceRules(candidateRules);
        let rules = sourceRules.clone(true, undefined, thisContext);
        /** Adopt for lookup, then adopt for sorting */
        sessionSetParent(rules, getCandidateParent(candidate as unknown as Node), thisContext);
        sessionSetSourceParent(rules, sourceParent, thisContext);
        let originalContext = thisContext.rulesContext;
        thisContext.rulesContext = rules;
        rules = await rules.eval(thisContext);
        thisContext.rulesContext = originalContext;
        sessionSetSourceParent(rules, sourceParent, thisContext);
        sessionSetParent(rules, getCandidateParent(candidate as unknown as Node), thisContext);
        // Rules should have index from eval, but ensure it matches candidate for sorting
        rules.index = candidate.index;
        // Skip empty Rules (e.g., containing only invisible nodes like comments)
        // Mark output Rules as mixin output - accessible only when lookup has a target
        rules.options.isMixinOutput = restrictMixinOutputLookup;
        outputRules.push(rules);
        continue;
      }
      // Less detached rulesets are represented as anonymous mixins (name is undefined).
      // Calling `@rulesetVar();` should *unlock* the rules into scope (including mixin definitions),
      // not eagerly execute/flatten them.
      if (!(candidate as any).name && !(candidate as any).params && !(candidate as any).guard) {
        const sourceRules = getRootSourceRules((candidate as any).rules);
        let unlocked = sourceRules.clone(false, undefined, thisContext);
        sessionSetParent(unlocked, getCandidateParent(candidate as unknown as Node), thisContext);
        sessionSetSourceParent(unlocked, sourceParent ?? caller, thisContext);
        // Detached ruleset calls in Less unlock their contents into the current scope.
        // They must remain visible to untargeted lookups like `.mixin();`.
        unlocked.options.isMixinOutput = false;
        unlocked.index = candidate.index;
        outputRules.push(unlocked);
        continue;
      }
      let rules = (candidate as any).rules as Rules;
      /** Create new rules, and add the candidate rules, to add to scope */
      rules = rules.clone(true, undefined, thisContext);
      // During mixin evaluation, local declarations must be directly visible in the current scope
      // so they properly shadow outer params/variables while the body executes.
      rules.options.rulesVisibility ??= {};
      rules.options.rulesVisibility.VarDeclaration = 'public';
      sessionSetParent(rules, getCandidateParent(candidate as unknown as Node), thisContext);
      sessionSetSourceParent(rules, sourceParent, thisContext);
      // Don't set index before evaluation - let evaluation assign the correct index
      /**
       * If we have params or a guard, we need to create a wrapper rules object,
       * so that the lookups of params and guard do not look at the cloned rules,
       * but instead look upwards / outwards.
       */
      let outerRules: Rules | undefined;

      /** Now we need to add our parameters, if any */
      let params = thisContext.session
        ? sessionGetField<List<Node> | undefined>(candidate as unknown as Node, 'params', thisContext)
        : (candidate as any).params as List<Node> | undefined;
      if (params) {
        outerRules = Rules.create([], {
          rulesVisibility: {
            Ruleset: 'public',
            Declaration: 'public',
            VarDeclaration: 'public',
            Mixin: 'public'
          }
        });
        sessionSetParent(
          outerRules,
          thisContext.rulesContext ?? getCandidateParent(candidate as unknown as Node),
          thisContext
        );
        outerRules.index = candidate.index;

        for (let i = 0; i < params.value.length; i++) {
          let param = params.value[i]!;
          if (param.type === 'Rest') {
            // Rest parameters need to be converted to VarDeclaration for registration
            // Auto-generate a name if Rest doesn't have one (Less allows unnamed rest params)
            let restName: string;
            if (typeof (param as any).value === 'string') {
              restName = (param as any).value;
            } else {
              // Auto-generate name: "rest", "rest1", "rest2", etc. based on position
              // Check if there are other rest params to avoid conflicts
              let restCount = 0;
              for (let j = 0; j < i; j++) {
                const p = params.value[j]!;
                if (p.type === 'Rest') {
                  restCount++;
                }
              }
              restName = restCount === 0 ? 'rest' : `rest${restCount + 1}`;
            }

            // Convert Rest to VarDeclaration so it can be registered and referenced.
            // If matching did not populate a node value, default to an empty sequence
            // (not a literal name/Nil), so @tail... behaves as "no remaining args".
            const restValue = isNode((param as any).value)
              ? (param as any).value as Node
              : (
                  thisContext.treeContext?.file
                    ? new Sequence([])
                    : new Any(restName, { role: 'property' })
                );
            const restVarDecl = new VarDeclaration({
              name: new Any(restName, { role: 'property' }),
              value: restValue
            }, { paramVar: true });

            // Replace Rest with VarDeclaration in params
            params.setData(i, restVarDecl);
            param = restVarDecl;
          }

          if (isNode(param, N.VarDeclaration)) {
            // Assign negative indices so they're conceptually "before" the rules and found first
            if (param.index === undefined) {
              // Use negative indices starting from -1, -2, etc. so they sort before regular rules
              param.index = -(i + 1);
            }
            // Mark as parameter var so it can be stripped from mixin output after evaluation.
            param.options ??= {};
            param.options.paramVar = true;
            // Keep parameter vars lookupable but hidden in normal output.
            // They still render in tests that set Node.fullRender=true.
            param.removeFlag(F_VISIBLE);
            outerRules.push(param);
          }
          // Note: Any with role: 'property' should have been converted to VarDeclaration during matching
          // If we see one here, it's an error - params should all be VarDeclaration by now
        }
        const shouldDefineArguments = Boolean(thisContext.treeContext?.file);
        if (shouldDefineArguments) {
          const argumentsArgs: Node[] = [];
          const argumentsDecl = new VarDeclaration({
            name: new Any('arguments', { role: 'property' }),
            value: new Sequence(argumentsArgs)
          }, { readonly: true, paramVar: true });
          argumentsDecl.removeFlag(F_VISIBLE);
          outerRules.push(argumentsDecl);
          const paramValues = params?.value
            .filter((p): p is VarDeclaration => isNode(p, N.VarDeclaration))
            .map(p => (p as any).value);
          const argumentNodes = (paramValues && paramValues.length > 0) ? paramValues : nodeArgs;
          for (const argNode of argumentNodes) {
            /** If a Rest param collected args into a Sequence, spread
             *  its items so @arguments reflects the actual arg count. */
            if (isNode(argNode, N.Sequence) && (argNode as Sequence).value.length > 1) {
              for (const item of (argNode as Sequence).value) {
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
      const canonicalGuard: Condition | Bool | undefined = (candidate as any).guard;
      let passes = true;
      let rulesContext = thisContext.rulesContext;
      // Call-time resolution is handled by the current context.rulesContext
      thisContext.rulesContext = outerRules ?? rules;
      const prevGuardSession = thisContext.session;
      try {
        if (canonicalGuard) {
          // Create a fresh session so that adopt() and eval() mutations (parent, evaluated,
          // preEvaluated) go to the session overlay and never corrupt canonical guard state.
          thisContext.session = new EvalSession({ resetEvalState: true });
          outerRules ??= Rules.create([]);
          outerRules.adopt(canonicalGuard, thisContext);
          getCandidateParent(candidate as unknown as Node).adopt(outerRules);
          /** Allow lookup on the inherited rules */
          passes = false;
          let guardPasses = false;
          let defaultGroup = DEF_FALSE_EITHER;
          if (hasDefault) {
            const originalIsDefault = thisContext.isDefault;
            const evalWithDefault = async (isDefaultValue: boolean): Promise<boolean> => {
              const guardNode = (candidate as any).guard as Condition | Bool | undefined;
              if (!guardNode) {
                return false;
              }
              // Fresh session per probe so each sees clean evaluated/preEvaluated state.
              const prevSession = thisContext.session;
              thisContext.session = new EvalSession({ resetEvalState: true });
              try {
                outerRules!.adopt(guardNode, thisContext);
                thisContext.isDefault = isDefaultValue;
                const probeResult = await guardNode.eval(thisContext);
                return probeResult instanceof Bool && probeResult.value === true;
              } finally {
                thisContext.session = prevSession;
              }
            };
            const passWhenDefaultFalse = await evalWithDefault(false);
            const passWhenDefaultTrue = await evalWithDefault(true);
            thisContext.isDefault = originalIsDefault;
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
            const evaldGuard = await canonicalGuard.eval(thisContext);
            /** Less guards only pass on explicit Bool(true), never JS truthiness. */
            guardPasses = evaldGuard instanceof Bool && evaldGuard.value === true;
            if (guardPasses) {
              passes = true;
              hasDefNoneCandidate = true;
            }
          }
          // Guard eval done — restore session before candidate output evaluation.
          thisContext.session = prevGuardSession;
        }
        if (!passes) {
          continue;
        }
        if (!canonicalGuard || !hasDefault) {
          // Non-default candidates are equivalent to Less's defNone group
          // (match regardless of default() assumption), so they suppress ambiguity.
          hasDefNoneCandidate = true;
        }
        if (canonicalGuard && hasDefault) {
          continue;
        }
        await evaluateCandidateOutput(candidate as Mixin, rules, outerRules, params);
      } finally {
        thisContext.rulesContext = rulesContext;
        thisContext.session = prevGuardSession;
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

    thisContext.session = prevMixinSession;

    /**
     * Now that we have output rules, sort them by
     * their original order
     */
    outputRules.sort(comparePosition);
    /** Create a rules wrapper - but optimize to avoid unnecessary nesting */
    let output: Rules;
    if (outputRules.length === 1) {
      output = outputRules[0]!;
      // Preserve explicit visibility semantics from special cases like detached-ruleset
      // unlocking, and only default to mixin-output visibility when not already set.
      output.options.isMixinOutput ??= restrictMixinOutputLookup;
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
        isMixinOutput: restrictMixinOutputLookup
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
    if (this instanceof Context) {
      output.index ??= this.ruleCounter++;
      // If the output Rules is empty, return Nil instead
      if (output.value.length === 0) {
        return new Nil();
      }
      return output;
    } else {
      const obj = output.toObject();
      return obj;
    }
  }

  return returnFunc;
}
