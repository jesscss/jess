import {
  Node,
  defineType,
  type NodeOptions,
  type LocationInfo,
  type TreeContext,
  F_STATIC
} from './node';
import { Context } from '../context';
import { isNode } from './util/is-node';
import { cast } from './util/cast';
import { type Ruleset, type RulesetValue } from './ruleset';
import { type AtRule } from './at-rule';
import { type Mixin } from './mixin';
import type { Selector } from './selector';
import { spaced, Sequence } from './sequence';
import { type PrintOptions, getPrintOptions } from './util/print';

import { atIndex } from './util/collections';
import type { Condition } from './condition';
import type { Bool } from './bool';
import * as Registries from './util/registry-utils';
import { tryExtendSelector } from './util/extend';
import { type MaybePromise, pipe, isThenable, serialForEach, tryStep } from '@jesscss/awaitable-pipe';
import { Nil } from './nil';
import { VarDeclaration } from './declaration-var';
import { Any } from './any';
import { List } from './list';
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
  readonly?: boolean;
  /**
   * all imports other than classic `@import` set returned rules to local.
   * The reason is that variables are not transitive, and you need to re-use
   * modules to get the same variables.
   */
  local?: boolean;
};

export interface Rules extends Node<Node[], RulesOptions & NodeOptions> {
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
  type = 'Rules';
  shortType = 'rules';
  override allowRuleRoot = true;
  override allowRoot = true;

  rulesetRegistry: Registries.RulesetRegistry | undefined;
  mixinRegistry: Registries.MixinRegistry | undefined;
  declarationRegistry: Registries.DeclarationRegistry | undefined;
  functionRegistry: Registries.FunctionRegistry | undefined;

  rulesIndexed = 0;
  _indexing = false;

  _indexRules() {
    if (this._indexing) {
      return; // Prevent recursive indexing
    }
    this._indexing = true;
    try {
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
   * Lazily create registries for types as needed.
   */
  register(
    type: 'ruleset' | 'declaration' | 'mixin' | 'function',
    node: Node
  ) {
    let registry = this[`${type}Registry`];
    if (!registry) {
      let className = `${type.charAt(0).toUpperCase()}${type.slice(1)}` as Capitalize<typeof type>;
      let RegistryClass = Registries[`${className}Registry`];
      registry = new RegistryClass(this);
      (this as any)[`${type}Registry`] = registry;
    }
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
      let className = `${type.charAt(0).toUpperCase()}${type.slice(1)}` as Capitalize<typeof type>;
      let RegistryClass = Registries[`${className}Registry`];
      registry = new RegistryClass(this);
      (this as any)[`${type}Registry`] = registry;
    }
    if (this.rulesIndexed < this.value.length) {
      this._indexRules();
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
    return (registry as any).find(keys, filterType, options);
  }

  /** Efficiently filter rules when copying */
  override copy(deep?: boolean, trim?: boolean): this {
    const newRules: Node[] = [];
    for (const node of this.value) {
      if (node.visible) {
        newRules.push(deep ? node.copy(deep, trim) : node);
      }
    }
    const rules = new Rules(newRules).inherit(this);
    if (trim) {
      rules.pre = undefined;
      rules.post = undefined;
    } else {
      rules.stripPrePost(rules, 'pre');
      rules.stripPrePost(rules, 'post');
    }
    return rules as this;
  }

  override toString(options?: PrintOptions): string {
    if (!this.visible && !this.fullRender) {
      return '';
    }
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();

    // At root level, prepend @charset if one was collected during evaluation (only once)
    const depth = options.frameState?.at(-1)?.depth ?? 0;
    const ctx = options.context;
    if (depth === 0 && ctx?.currentCharset && !ctx.charsetEmitted) {
      const charset = ctx.currentCharset;
      // Use capture to avoid double-writing (toTrimmedString writes to writer AND returns the string)
      const charsetStr = w.capture(() => charset.toTrimmedString(options));
      w.add(charsetStr, charset);
      w.add('\n');
      ctx.charsetEmitted = true;
    }

    this.processPrePost('pre', '', options);
    const bodyMark = w.mark();
    const bodyStr = this.toTrimmedString(options);
    const bodyEmitted = w.getSince(bodyMark);
    if (bodyEmitted.length === 0 && bodyStr) {
      w.add(bodyStr);
    }
    // If no explicit Rules.post at root, propagate last child's post
    if (depth === 0 && (this.post === 0 || this.post === undefined)) {
      let lastVisible: Node | undefined;
      for (let i = this.value.length - 1; i >= 0; i--) {
        const n = this.value[i]!;
        if (n.visible) {
          lastVisible = n;
          break;
        }
      }
      if (lastVisible) {
        lastVisible.processPrePost('post', '', options);
      }
    }
    this.processPrePost('post', '', options);
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
    rulesVisibility.Declaration ??= 'public';
    rulesVisibility.Ruleset ??= 'public';
    /** @todo - deprecate and warn */
    rulesVisibility.Mixin ??= 'public';
    super(value ?? [], options, location, treeContext);
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
    const depth = opts.depth ?? opts.frameState?.at(-1)?.depth ?? 0;
    // #region agent log
    // eslint-disable-next-line
    fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'rules.ts:293', message: 'toBraced entry', data: { depth, optionsDepth: opts.depth, frameStateDepth: opts.frameState?.at(-1)?.depth, frameStateLength: opts.frameState?.length ?? 0 }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'indent-fix-v2', hypothesisId: 'A' }) }).catch(() => {});
    // #endregion
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
    // #region agent log
    // eslint-disable-next-line
    fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'rules.ts:317', message: '_emitRulesBody entry', data: { depth, optionsDepth: options.depth, frameStateDepth: options.frameState?.at(-1)?.depth, frameStateLength: options.frameState?.length ?? 0, itemsCount: this.value.filter(n => n.visible && !(n.type === 'Any' && (n as any).options?.role === 'charset')).length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'indent-fix-v2', hypothesisId: 'B' }) }).catch(() => {});
    // #endregion
    const space = options.indent!;
    const { value } = this;

    // Skip charset nodes - they are collected and prepended at root level
    const items = value.filter(n => n.visible && !(n.type === 'Any' && (n as any).options?.role === 'charset'));

    if (items.length === 0) {
      return;
    }

    // No spacing flags; writer.capture is used where needed

    let previousEndsWithNewline = false;
    for (let idx = 0; idx < items.length; idx++) {
      const n = items[idx]!;
      if (idx > 0) {
        // Only add newline if previous item didn't end with one
        // This prevents double newlines when renderWithFrameFlattening already added one
        if (!previousEndsWithNewline) {
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
      const childOptions = isChildRules ? { ...options, depth } : { ...options, depth };
      // #region agent log
      if (n.type === 'AtRule' || n.type === 'Ruleset') {
        // eslint-disable-next-line
        fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'rules.ts:350', message: '_emitRulesBody calling child', data: { childType: n.type, depthProvided: depth, isChildRules, nodeName: (n as any).value?.name?.toString?.() || (n as any).value?.selector?.toString?.() }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'indent-fix-v2', hypothesisId: 'C' }) }).catch(() => {});
      }
      // #endregion
      let rule = w.capture(() => n.toTrimmedString(childOptions));
      // Check if the captured output ends with a newline
      previousEndsWithNewline = rule.endsWith('\n');
      w.add(rule, n); // Pass node as origin to preserve location info
      if (n.requiredSemi && n.options.semi !== false) {
        w.add(';', n);
        previousEndsWithNewline = false; // Semicolon means it doesn't end with newline
      }
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
  flatRules(visibleOnly: boolean = false) {
    const finalRules: Node[] = [];
    const iterateRules = (rules: Rules) => {
      for (let n of rules.value) {
        if (isNode(n, 'Rules')) {
          iterateRules(n);
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
    return this.value.filter(n => n.visible);
  }

  /**
   * Return an object representation of a ruleset
   */
  toObject(convertToPrimitives: true): Record<string, string | number>;
  toObject(convertToPrimitives: false): Record<string, Node>;
  toObject(convertToPrimitives?: boolean): Record<string, string | number | Node>;
  toObject(convertToPrimitives: boolean = true): Record<string, string | number | Node> {
    let output = new Map<string, string | number | Node>();
    const iterateRules = (rules: Rules) => {
      for (let n of rules.value) {
        if (isNode(n, 'Declaration')) {
          let { name, value, important } = n.value;
          if (convertToPrimitives) {
            let primitive = value.valueOf();
            let outputValue = important ? `${primitive} ${important}` : primitive;
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
    if (isNode(node, 'Rules')) {
      let rulesVisibility = options?.rulesVisibility ?? node.options.rulesVisibility ?? {};

      /** These are public by default */
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
    } else if (isNode(node, 'Declaration')) {
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
        opts.start = node.index;
        let result = this.find('declaration', key, node.type as 'Declaration', opts);
        if (result) {
          if (result.options?.readonly || opts.readonly) {
            throw new ReferenceError(`"${key}" is readonly`);
          }

          // Find the Rules node that contains the found declaration
          let foundRules: Rules | undefined = result.parent as Rules;

          if (!foundRules) {
            throw new Error(`Could not find parent Rules for declaration '${key}'`);
          }

          // Create a new declaration with the same name but our value
          const newDeclaration = node.copy();
          newDeclaration.options = { ...newDeclaration.options };
          newDeclaration.options.setDefined = undefined; // Remove setDefined flag

          // Instead of inserting into the array, just register it in the registry
          // Because all nodes are indexed linearly, we can keep the same index I think?

          foundRules.register('declaration', newDeclaration);
        } else {
          throw new ReferenceError(`"${key}" is not defined`);
        }
      }

      this.register('declaration', node);
    } else if (isNode(node, 'Ruleset')) {
      // Register to 'mixin' for mixin calls and 'ruleset' for extends
      // Register to 'mixin' for mixin calls and 'ruleset' for extends
      this.register('mixin', node);
      this.register('ruleset', node);
    } else if (isNode(node, 'Mixin')) {
      this.register('mixin', node);
    }
  }

  push(node: Node) {
    this.adopt(node);
    this.value.push(node);
    this.registerNode(node);
  }

  at(index: number) {
    return atIndex(this.value, index);
  }

  /**
   * This traverses deeply to visit all nodes, but indexes locally.
   */
  override preEval(context: Context) {
    if (!this.preEvaluated) {
      let rules = this.maybeClone(context);
      rules.preEvaluated = true;

      // Save current context and set up new context for variable lookups during preEval
      const saved = this._snapshotContext(context);
      this._setupContextForRules(context, rules);
      // Register main root as extend root if this is the root (needed for extends in preEval)
      // We need to check if this rules is the context.root AND the extendRoots.root is not set yet
      const isMainRoot = rules === context.root && !context.extendRoots.root;
      if (isMainRoot) {
        context.extendRoots.registerRoot(rules);
        context.extendRoots.pushExtendRoot(rules);
      }

      // Assign index to all the nodes if not already set,
      // in linear source order.
      if (rules.index === undefined) {
        for (const node of rules.nodes(false, true)) {
          if (node.index === undefined) {
            node.index = context.ruleCounter++;
          }
        }
      }

      // Multi-pass registration system for handling interpolated names
      return this._multiPassPreEval(rules, context, saved);
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
      // Check if node has a static name (can be registered immediately)
      if (node.type === 'Any' && node.options.role === 'charset') {
        /** Special case where we register the charset node immediately */
        rules.value[index] = (node as Any).preEval(context);
        return;
      }
      if (this._hasStaticName(node)) {
        // Pre-evaluate nodes with static names before registration
        // This ensures selectors are evaluated and keySets are available for rulesets
        const preEvald = node.preEval(context);
        if (isThenable(preEvald)) {
          return (preEvald as Promise<Node>).then((preEvaldNode) => {
            rules.value[index] = preEvaldNode;
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
        context.root = saved.root;
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
   * Check if a node has a static name that can be registered immediately
   */
  private _hasStaticName(node: Node): boolean {
    if (isNode(node, 'VarDeclaration')) {
      const name = node.value.name;
      return this._isStatic(name);
    }
    if (isNode(node, 'Mixin')) {
      const name = node.value.name;
      return this._isStatic(name);
    }
    if (isNode(node, 'StyleImport')) {
      const path = node.value.path;
      return this._isStatic(path);
    }
    if (isNode(node, 'Ruleset')) {
      const selector = node.value.selector;
      // BasicSelector, CompoundSelector, ComplexSelector etc. are always static
      // Only Interpolated selectors need resolution
      if (isNode(selector, ['BasicSelector', 'CompoundSelector', 'ComplexSelector', 'SelectorList'])) {
        return true;
      }
      // After preEval, the selector should be resolved to static identifiers
      if (node.preEvaluated) {
        return true;
      }
      // Check F_STATIC flag for other selector types
      if (selector && 'hasFlag' in selector && typeof selector.hasFlag === 'function') {
        return selector.hasFlag(F_STATIC);
      }
      return false;
    }
    // For other node types, assume they can be registered if they have static names
    return node.hasFlag(F_STATIC);
  }

  /**
   * Register a node if it's eligible for registration
   */
  private _registerNodeIfEligible(rules: Rules, node: Node, context: Context) {
    if (isNode(node, 'Declaration')) {
      rules.registerNode(node);
    } else if (isNode(node, 'Mixin')) {
      rules.registerNode(node);
    } else if (isNode(node, 'Ruleset')) {
      // registerNode handles both 'mixin' and 'ruleset' registries
      rules.registerNode(node);
    }
  }

  /**
   * Multi-pass resolution of dynamic nodes with interpolated names
   */
  private _resolveDynamicNodes(rules: Rules, context: Context, saved: any, dynamicNodes: Node[]): MaybePromise<this> {
    const unresolvedNodes: Node[] = [...dynamicNodes];
    const resolvedNodes: Node[] = [];
    let firstError: Error | undefined;
    let resolutionAttempts = 0;
    const MAX_RESOLUTION_ATTEMPTS = 5;

    const attemptResolution = (): MaybePromise<this> => {
      resolutionAttempts++;
      if (resolutionAttempts > MAX_RESOLUTION_ATTEMPTS) {
        throw new Error(`Could not resolve node.`);
      }
      const stillUnresolved: Node[] = [];
      let madeProgress = false;

      for (const node of unresolvedNodes) {
        try {
          // Try to preEval the node
          const result = node.preEval(context);

          if (isThenable(result)) {
            // Handle async preEval
            return (result as Promise<Node>).then((resolvedNode) => {
              // Register rulesets after preEval regardless of static name
              if (resolvedNode.type === 'Ruleset') {
                // registerNode handles both 'mixin' and 'ruleset' registries
                rules.registerNode(resolvedNode);
              }
              if (this._hasStaticName(resolvedNode)) {
                resolvedNodes.push(resolvedNode);
                this._registerNodeIfEligible(rules, resolvedNode, context);
                madeProgress = true;
              } else {
                stillUnresolved.push(resolvedNode);
              }
              return attemptResolution();
            });
          }

          // Register rulesets after preEval regardless of static name
          if (result.type === 'Ruleset') {
            // registerNode handles both 'mixin' and 'ruleset' registries
            rules.registerNode(result);
          }

          // Check if the node now has a static name
          if (this._hasStaticName(result)) {
            resolvedNodes.push(result);
            this._registerNodeIfEligible(rules, result, context);
            madeProgress = true;
          } else {
            stillUnresolved.push(result);
          }
        } catch (error) {
          if (!firstError) {
            firstError = error as Error;
          }
          stillUnresolved.push(node);
        }
      }

      // Update the rules with resolved nodes
      for (let i = 0; i < rules.value.length; i++) {
        const node = rules.value[i]!;
        const resolvedNode = resolvedNodes.find(n => n.index === node.index);
        if (resolvedNode && resolvedNode !== node) {
          rules.value[i] = resolvedNode.inherit(node);
          rules.adopt(resolvedNode);
        }
      }

      // If we made progress, try again
      if (madeProgress && stillUnresolved.length > 0) {
        unresolvedNodes.length = 0;
        unresolvedNodes.push(...stillUnresolved);
        return attemptResolution();
      }

      // If we still have unresolved nodes and we're done with rules evaluation, throw the first error
      if (stillUnresolved.length > 0 && firstError) {
        throw firstError;
      }

      // Restore context after preEval is complete
      context.rulesContext = saved.rulesContext;
      context.treeRoot = saved.treeRoot;
      context.root = saved.root;

      return rules as this;
    };

    return attemptResolution();
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
          if (!isNode(node, 'VarDeclaration')) {
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
      if (!isNode(node, 'VarDeclaration')) {
        rules.registerNode(result);
      }
    }

    // Restore context after preEval is complete (for async case)
    if (saved) {
      context.rulesContext = saved.rulesContext;
      context.treeRoot = saved.treeRoot;
      context.root = saved.root;
    }
    return rules as this;
  }

  /** Save current context roots to restore later */
  private _snapshotContext(context: Context) {
    return {
      rulesContext: context.rulesContext,
      treeContext: context.treeContext,
      treeRoot: context.treeRoot,
      root: context.root
    } as const;
  }

  /** Setup context for evaluating these rules */
  private _setupContextForRules(context: Context, rules: Rules) {
    const treeContext = context.treeContext;
    if (!treeContext || treeContext !== rules.treeContext) {
      context.allRoots.push(rules);
      context.treeContext = rules.treeContext;
      context.treeRoot = rules;
      const wasRootSet = context.root !== undefined;
      context.root ??= rules;
    }
    context.rulesContext = rules;
  }

  /** Build the evaluation queue partitioned by priority */
  private _buildEvalQueue(rules: Rules): EvalQueueMap {
    let evalQueue: EvalQueueMap = new Map();
    for (let item of rules) {
      let [, rule] = item;
      let priority = NodeTypeToPriority.get(rule.type) ?? Priority.None;
      let queue = evalQueue.get(priority) ?? [];
      queue.push(item as [number, Node]);
      evalQueue.set(priority, queue);
    }
    return evalQueue;
  }

  /** Evaluate the built queues in priority order */
  private _evaluateQueue(rules: Rules, evalQueue: EvalQueueMap, context: Context): MaybePromise<boolean> {
    let rulesToHoist = false;
    // Track nodes that have been retried to avoid infinite loops
    const retriedNodes = new Set<Node>();

    const priorities: Priority[] = Array.from({ length: Priority.Highest + 1 }).map((_, i) => (Priority.Highest - i) as Priority);
    const phaseRun = serialForEach(priorities, (p: Priority) => {
      const queue = evalQueue.get(p);
      if (!queue) {
        return;
      }
      const entries: Array<[number, [number, Node]]> = Array.from(queue.entries()) as any;
      const innerResult = serialForEach(entries, ([q, item]: [number, [number, Node]]) => {
        const [idx, rule] = item;

        /**
         * Var declarations have late evaluation, so they are skipped.
         * (Meaning: they are not evaluated until they are referenced.)
         */
        if (isNode(rule, 'VarDeclaration')) {
          return;
        }

        // Check if this node should be skipped (already moved to retry queue)
        // BUT: if we're at Priority.None, we should process it even if it was retried
        // because this is the retry attempt
        if (retriedNodes.has(rule) && p > Priority.None) {
          return;
        }

        return pipe(
          tryStep(() => rule.eval(context), {
            onError(error) {
              // ReferenceErrors (e.g., from mixin lookups) should not be retried - they should fail immediately
              if (error instanceof ReferenceError) {
                throw error;
              }
              // If evaluation failed and we haven't retried this node yet,
              // and we're not already at the none priority, retry at none priority
              if (p > Priority.None && !retriedNodes.has(rule)) {
                retriedNodes.add(rule);
                // Move to lowest priority queue for retry
                const lowQueue = evalQueue.get(Priority.None) || [];
                lowQueue.push([idx, rule]);
                evalQueue.set(Priority.None, lowQueue);
                // Skip processing for now, will be retried at Priority.None
                return;
              }
              // If we're already at the lowest priority, rethrow
              throw error;
            }
          }),
          (result: Node | undefined) => {
            // If result is undefined (onError returned without throwing), skip processing
            if (result === undefined) {
              return;
            }
            // Apply the result
            if (result !== rule) {
              rules.value[idx] = result;
              queue[q] = [idx, result];
              // If a StyleImport evaluated to Rules, register them in the parent's _rulesSet
              // so variables from the import can be found by the parent
              if (isNode(result, 'Rules')) {
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
            if (result.options.hoistToRoot) {
              rulesToHoist = true;
            }
          }
        );
      });
      return innerResult;
    });

    if (isThenable(phaseRun)) {
      return (phaseRun as Promise<void>).then(() => rulesToHoist);
    }
    return rulesToHoist;
  }

  override evalNode(context: Context): MaybePromise<this> {
    const saved = this._snapshotContext(context);
    context.rulesEvalStack.push(this.sourceNode as Rules);
    return pipe(
      () => {
        this._setupContextForRules(context, this);
        // Extend root should already be registered in preEval, but ensure it's on the stack
        // (it might have been popped if this is a nested Rules evaluation)
        const isMainRoot = this === context.root;
        if (isMainRoot && context.extendRoots.extendRootStack.length === 0) {
          context.extendRoots.pushExtendRoot(this);
        }
        // Synchronous preEval
        const rules = this;
        if (rules.evaluated) {
          return { rules, rulesToHoist: false };
        }
        const evalQueue = this._buildEvalQueue(rules);
        const maybeHoist = this._evaluateQueue(rules, evalQueue, context);
        if (isThenable(maybeHoist)) {
          return (maybeHoist as Promise<boolean>).then(rulesToHoist => ({ rules, rulesToHoist }));
        }
        return { rules, rulesToHoist: maybeHoist as boolean };
      },
      ({ rules, rulesToHoist }: { rules: Rules; rulesToHoist: boolean }) => {
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
                  if (isNode(decl, 'VarDeclaration')) {
                    // Check if a variable with this name exists in the current Rules' registry
                    let currentDeclarations = currentRegistry.index.get(key);
                    if (currentDeclarations) {
                      for (const currentDecl of currentDeclarations) {
                        if (isNode(currentDecl, 'VarDeclaration') && !currentDecl.options?.setDefined) {
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
        // Use the first root in allRoots as the outermost root
        const outermostRoot = context.allRoots.length > 0 ? context.allRoots[0] : context.root;
        const isOutermost = rules === outermostRoot;

        if (isOutermost) {
          /**
           * Process all registered extends using the extend roots registry system.
           * Only process at the outermost level after all evaluation is complete.
           */
          for (const [target, selectorWithExtend, partial, extendRoot] of context.extends) {
            // Get accessible roots for this extend's root
            const accessibleRoots = context.extendRoots.getAccessibleRoots(extendRoot);

            // For .child:-extend(.base):
            // - target = .base (what to find)
            // - selectorWithExtend = .child (the selector that had the extend)
            // - We want to find rulesets matching .base and extend them with .child
            // Find rulesets matching target (the selector we're extending) in accessible roots
            let rulesetSet: Ruleset[] | undefined;
            for (const searchRoot of accessibleRoots) {
              const found = searchRoot.find('ruleset', target.keySet);
              if (found) {
                if (rulesetSet) {
                  rulesetSet.push(...found);
                } else {
                  // not sure why the agent removed this?
                  // rulesetSet = found;
                }
              }
            }

            // Apply extends to found rulesets
            // tryExtendSelector(target, find, extendWith, partial)
            // - target: the selector to extend (ruleset.selector, which matches target from extend)
            // - find: what to find within target (target - we're looking for target in itself)
            // - extendWith: what to extend with (selectorWithExtend - the selector that had the extend)
            if (rulesetSet) {
              rulesetSet.forEach((ruleset) => {
                let result = tryExtendSelector(ruleset.selector as Selector, target, selectorWithExtend, partial);
                if (result) {
                  ruleset.value.selector = result.value;
                }
              });
            }
          }
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
        // Pop extend root if we pushed it (check if this is still the root)
        if (rules === context.root) {
          context.extendRoots.popExtendRoot();
        }
        context.rulesEvalStack.pop();
        return rules;
      }
    ) as MaybePromise<this>;
  }

  /**
   * Renders with optional frame-based flattening for collapseNesting
   *
   * @note - This is a more efficient way to "hoist" rules to the root
   * than Less's approach, where arrays are copied and flattened. Instead,
   * the nested structure is preserved, and we just track the frames we're in.
   * Once we need to hoist a child, we print closing braces for the current frame,
   * render the opening of the new frame, and continue rendering the child.
   *
   * This also allows us to properly match CSS's nesting behavior, since we don't
   * push "hoisted" rules to the end of the current frame.
   *
   * @param options PrintOptions for rendering
   * @param currentNode The node to render
   */
  renderWithFrameFlattening(
    options: PrintOptions,
    currentNode: Ruleset | AtRule
  ) {
    let opts = getPrintOptions(options);
    // #region agent log
    // eslint-disable-next-line
    fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'rules.ts:1089', message: 'renderWithFrameFlattening entry', data: { optionsDepth: options.depth, optsDepth: opts.depth, currentNodeType: currentNode.type, currentNodeName: (currentNode as any).value?.name?.toString?.() || (currentNode as any).value?.selector?.toString?.() }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'indent-fix-v2', hypothesisId: 'H' }) }).catch(() => {});
    // #endregion
    let w = options.writer!;
    let mark = w.mark();
    // frameState is guaranteed to exist by getPrintOptions
    const frameState = opts.frameState!;

    // Track the initial frameState length - we'll close back to this at the end
    const initialFrameStateLength = frameState.length;
    // Track which frames we actually open during this call
    const openedFrames: (Ruleset | AtRule)[] = [];

    // If we have frames, we need to flatten
    let currentState = frameState.at(-1) ?? { depth: 0 };
    let currentDepth = currentState.depth;

    // Build newFrames from currentNode.frames, but filter out frames that are already open in frameState
    // This prevents reopening frames that can't be hoisted past (e.g., @page inside @media)
    let framesFromParent = (currentNode.frames ?? []).filter(frame => isNode(frame, 'AtRule')) as AtRule[];
    let newFrames: (AtRule | Ruleset)[] = [];
    for (const frame of framesFromParent) {
      // Only include frames that aren't already in frameState
      if (!frameState.some(state => state.frame === frame)) {
        newFrames.push(frame);
      }
    }
    // Always include currentNode itself (it's the frame we're rendering)
    newFrames.push(currentNode);

    /**
     * If the current open frames equals the at-rule frames we need, then we don't need to
     * close and re-render them.
     */
    let isAtRule = currentNode.type === 'AtRule';
    let rules = currentNode.value.rules!;
    let length = rules.value.length;
    /**
     * This may be hard to follow at first, but while rendering a hoisted
     * node, we don't render its opening until we reach the first
     * non-hoisted child. This is so we don't render a ruleset opening
     * or at-rule opening just to immediately close it with empty braces.
     */
    // We don't need to pre-compute hasHoistedChildren - we can determine it dynamically
    // when we're at the last non-hoisted child by checking if there are more children coming

    for (let i = 0; i < length; i++) {
      const child = rules.value[i]!;
      if (!child.visible) {
        continue;
      }

      // Check if the next child is non-hoisted (needs frames to be open)
      let nextChildIsNonHoisted = false;
      for (let j = i + 1; j < length; j++) {
        const nextChild = rules.value[j];
        if (!nextChild?.visible) {
          continue;
        }
        const isNextHoisted = isNode(nextChild, ['AtRule', 'Ruleset'])
          && Object.prototype.hasOwnProperty.call(nextChild, 'frames');
        if (!isNextHoisted) {
          nextChildIsNonHoisted = true;
        }
        break; // Only check the next visible child
      }

      /** Recalculate which frames are already open by comparing newFrames with current frameState */
      let newFramesStartIndex = 0;
      for (let j = 0; j < newFrames.length; j++) {
        if (frameState.length > j && newFrames[j] === frameState[j]?.frame) {
          newFramesStartIndex++;
        } else {
          break;
        }
      }

      // Recursively traverse through Rules nodes and hoisted children until we find a non-hoisted child
      // Track frames as we go, and render openings/closings when we hit actual content
      const renderChildRecursive = (node: Node, currentFrames: (Ruleset | AtRule)[], frameStartIndex: number, shouldReopenFrames: boolean): void => {
        // Check if this is a hoisted Ruleset/AtRule
        const isAtRuleOrRuleset = isNode(node, ['AtRule', 'Ruleset']);
        const hasFramesProperty = isAtRuleOrRuleset && Object.prototype.hasOwnProperty.call(node, 'frames');
        const isHoisted = isAtRuleOrRuleset && hasFramesProperty;

        if (isHoisted) {
          // #region agent log
          // eslint-disable-next-line
          fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'rules.ts:1183', message: 'hoisted child - checking frames', data: { nodeType: node.type, nodeName: (node as any).value?.name?.toString?.() || (node as any).value?.selector?.toString?.() || node.type, frameStateLength: frameState.length, initialFrameStateLength, currentFramesLength: currentFrames.length, shouldReopenFrames, frameStateFrames: frameState.map(s => ({ type: s.frame?.type, name: (s.frame as any)?.value?.name?.toString?.() || (s.frame as any)?.value?.selector?.toString?.() })), currentFramesNames: currentFrames.map(f => ({ type: f.type, name: (f as any)?.value?.name?.toString?.() || (f as any)?.value?.selector?.toString?.() })) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'media-close-reopen', hypothesisId: 'A' }) }).catch(() => {});
          // #endregion
          // Close any open frames (except AtRules) before rendering this hoisted child
          // Track which frames we close so we can re-open them if the next child is non-hoisted
          // BUT: Don't close frames that the next child also needs (check currentFrames)
          const closedFrames: Array<{ frame: Ruleset | AtRule; depth: number }> = [];
          // Check which frames from frameState are also in currentFrames (needed by next child)
          const framesNeededByNextChild = new Set(currentFrames);
          while (frameState.length > initialFrameStateLength) {
            let state = frameState[frameState.length - 1];
            if (!state?.frame) {
              frameState.pop();
              continue;
            }
            let frame = state.frame;
            if (isNode(frame, 'AtRule')) {
              // Don't close AtRules - they can't be hoisted past
              break;
            }
            // #region agent log
            // eslint-disable-next-line
            fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'rules.ts:1200', message: 'hoisted child - checking if should close frame', data: { frameType: frame.type, frameName: (frame as any).value?.name?.toString?.() || (frame as any).value?.selector?.toString?.() || frame.type, isNeededByNextChild: framesNeededByNextChild.has(frame), shouldReopenFrames }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'media-close-reopen', hypothesisId: 'B' }) }).catch(() => {});
            // #endregion
            // If this frame is needed by the next child, don't close it
            if (framesNeededByNextChild.has(frame)) {
              break;
            }
            frameState.pop();
            closedFrames.unshift({ frame, depth: state.depth }); // unshift to maintain order for re-opening
            if (openedFrames.length > 0 && openedFrames[openedFrames.length - 1] === frame) {
              openedFrames.pop();
            }
            let space = ''.padStart(state.depth * 2);
            w.add(`${space}}\n`);
          }
          // #region agent log
          // eslint-disable-next-line
          fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'rules.ts:1215', message: 'hoisted child - closed frames', data: { closedFramesCount: closedFrames.length, closedFramesNames: closedFrames.map(cf => ({ type: cf.frame.type, name: (cf.frame as any)?.value?.name?.toString?.() || (cf.frame as any)?.value?.selector?.toString?.() })), frameStateLength: frameState.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'media-close-reopen', hypothesisId: 'C' }) }).catch(() => {});
          // #endregion
          // Render the hoisted child (it will handle its own frame tracking)
          node.toTrimmedString(opts);
          // Re-open frames if the next child is non-hoisted (needs frames to be open)
          // Just add them back to frameState without re-rendering the headers
          if (shouldReopenFrames && closedFrames.length > 0) {
            // #region agent log
            // eslint-disable-next-line
            fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'rules.ts:1223', message: 'hoisted child - reopening frames', data: { closedFramesCount: closedFrames.length, shouldReopenFrames }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'media-close-reopen', hypothesisId: 'D' }) }).catch(() => {});
            // #endregion
            for (const closedFrame of closedFrames) {
              frameState.push({ frame: closedFrame.frame, depth: closedFrame.depth });
              openedFrames.push(closedFrame.frame);
              // Don't re-render the opening - it was already rendered, we just need to track it
            }
          }
        } else if (isNode(node, 'Rules')) {
          // Recursively traverse Rules nodes
          const rulesNode = node as Rules;
          const nestedLength = rulesNode.value.length;
          for (let nestedIdx = 0; nestedIdx < nestedLength; nestedIdx++) {
            const nestedChild = rulesNode.value[nestedIdx];
            if (!nestedChild?.visible) {
              continue;
            }
            // Check if the next nested child is non-hoisted
            let nextNestedIsNonHoisted = false;
            for (let j = nestedIdx + 1; j < nestedLength; j++) {
              const nextNested = rulesNode.value[j];
              if (!nextNested?.visible) {
                continue;
              }
              const isNextHoisted = isNode(nextNested, ['AtRule', 'Ruleset'])
                && Object.prototype.hasOwnProperty.call(nextNested, 'frames');
              if (!isNextHoisted) {
                nextNestedIsNonHoisted = true;
              }
              break;
            }
            renderChildRecursive(nestedChild, currentFrames, frameStartIndex, nextNestedIsNonHoisted);
          }
        } else {
          // This is a non-hoisted child (Declaration, etc.)
          // Per the comment: "we don't render its opening until we reach the first non-hoisted child"
          // Use frameState as the source of truth - if frames aren't open yet, open them now
          // Recalculate which frames are already open by comparing currentFrames with frameState
          // This is important because frameState may have changed during recursive traversal
          let alreadyOpenCount = 0;
          for (let i = 0; i < currentFrames.length; i++) {
            if (frameState.length > i && frameState[i]?.frame === currentFrames[i]) {
              alreadyOpenCount++;
            } else {
              break;
            }
          }
          let d = alreadyOpenCount;
          // If frames aren't open yet (frameState is at initial length), open them now
          if (frameState.length === initialFrameStateLength) {
            // Open all frames in currentFrames that aren't already open, starting from alreadyOpenCount
            for (let frameIdx = alreadyOpenCount; frameIdx < currentFrames.length; frameIdx++) {
              const frameToOpen = currentFrames[frameIdx];
              if (!frameToOpen) {
                continue;
              }
              // Check if this frame is already in frameState
              const alreadyInFrameState = frameState.some(state => state.frame === frameToOpen);
              // #region agent log
              // eslint-disable-next-line
              fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'rules.ts:1220', message: 'renderWithFrameFlattening checking frame', data: { frameType: frameToOpen.type, frameName: (frameToOpen as any).value?.name?.toString?.() || (frameToOpen as any).value?.selector?.toString?.(), alreadyInFrameState, frameStateLength: frameState.length, initialFrameStateLength }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'indent-fix-v2', hypothesisId: 'G' }) }).catch(() => {});
              // #endregion
              if (!alreadyInFrameState) {
              // Calculate depth for this frame:
              // Depth is determined by the number of boundaried at-rules (at-rules that can't be hoisted past)
              // Rulesets don't affect depth - only at-rules do
              // A "hoisted to root" node resets at zero unless there are at-rules it can't hoist past

                // Find the last at-rule depth in frameState (ignore rulesets)
                let lastAtRuleDepth = -1;
                for (let i = frameState.length - 1; i >= 0; i--) {
                  const state = frameState[i];
                  if (state?.frame && isNode(state.frame, 'AtRule')) {
                    lastAtRuleDepth = state.depth;
                    break;
                  }
                }

                // Count how many at-rules are in frameState (for determining if we're at root)
                let atRuleCount = 0;
                for (let i = 0; i < frameState.length; i++) {
                  const state = frameState[i];
                  if (state?.frame && isNode(state.frame, 'AtRule')) {
                    atRuleCount++;
                  }
                }

                // Check if this frame is hoisted (it's in currentNode.frames, meaning it was hoisted)
                const isHoisted = isNode(frameToOpen, 'AtRule') && frameToOpen.options.hoistToRoot
                  && framesFromParent.includes(frameToOpen as AtRule);

                if (atRuleCount === 0 && isHoisted) {
                // No at-rules in frameState and frame is hoisted - start at depth 0
                  d = 0;
                } else if (lastAtRuleDepth >= 0) {
                // There are at-rules it can't hoist past - nest deeper
                  d = lastAtRuleDepth + 1;
                } else {
                // No at-rules, but not hoisted - use opts.depth or frameIdx
                  d = opts.depth ?? frameIdx;
                }
                // #region agent log
                // eslint-disable-next-line
              fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'rules.ts:1201', message: 'renderWithFrameFlattening opening frame', data: { calculatedDepth: d, optsDepth: opts.depth, frameStateLength: frameState.length, lastFrameDepth: frameState[frameState.length - 1]?.depth, frameIdx, frameType: frameToOpen.type, frameName: (frameToOpen as any).value?.name?.toString?.() || (frameToOpen as any).value?.selector?.toString?.() }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'indent-fix-v2', hypothesisId: 'D' }) }).catch(() => {});
                // #endregion
                frameState.push({ frame: frameToOpen, depth: d });
                openedFrames.push(frameToOpen);
                // Set depth for renderOpening - node will indent itself
                const renderOpts = { ...opts, depth: d };
                frameToOpen.renderOpening(renderOpts);
                w.add('{\n');
              }
            }
            // After opening all frames, declarations should be indented at the last frame's depth + 1
            // For non-hoisted children, both at-rules AND rulesets affect depth
            d = frameState.length > 0 ? frameState[frameState.length - 1]!.depth + 1 : alreadyOpenCount + 1;
          } else {
            // Frames are already open from a previous non-hoisted child
            // Declarations should be indented at the last frame's depth + 1
            // For non-hoisted children, both at-rules AND rulesets affect depth
            d = frameState.length > 0 ? frameState[frameState.length - 1]!.depth + 1 : alreadyOpenCount + 1;
          }

          const isRulesNode = isNode(node, 'Rules');
          // Set depth for children - use calculated depth d
          const childOpts = { ...opts, depth: d };
          // #region agent log
          // eslint-disable-next-line
          fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'rules.ts:1220', message: 'renderWithFrameFlattening rendering child', data: { childType: node.type, depthProvided: d, frameStateLength: frameState.length, lastFrameDepth: frameState[frameState.length - 1]?.depth, isRulesNode, nodeName: (node as any).value?.name?.toString?.() || (node as any).value?.selector?.toString?.() }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'indent-fix-v2', hypothesisId: 'E' }) }).catch(() => {});
          // #endregion
          if (!isRulesNode) {
            let space = ''.padStart(d * 2);
            w.add(space);
          }
          let out = w.capture(() => node.toTrimmedString(childOpts));
          w.add(out);
          if (node.requiredSemi && node.options.semi !== false) {
            w.add(';');
          }
          w.add('\n');
        }
      };

      renderChildRecursive(child, newFrames, newFramesStartIndex, nextChildIsNonHoisted);
    }

    // At the end, close any frames that were opened during this renderWithFrameFlattening call
    // This only happens if there are no more children
    // Close frames in reverse order - pop from frameState and verify it matches our opened frames
    for (let i = openedFrames.length - 1; i >= 0; i--) {
      const expectedFrame = openedFrames[i];
      if (!expectedFrame) {
        break;
      }
      if (frameState.length === 0) {
        break;
      }
      let state = frameState[frameState.length - 1];
      if (!state?.frame || state.frame !== expectedFrame) {
        // Frame doesn't match - might have been closed already or frameState is corrupted
        break;
      }
      frameState.pop();
      let space = ''.padStart(state.depth * 2);
      w.add(`${space}}\n`);
    }
  }
}

export const rules = defineType(Rules, 'Rules');

type EvalQueueMap = Map<Priority, Array<[number, Node]>>;

/**
 * @todo - Will need lots of massaging, to resolve things like
 * mixins which rely on variables which have interpolated names,
 * and variables with interpolated names that rely on mixins.
 */
const NodeTypeToPriority = new Map([
  /** First, register vars and props */
  ['VarDeclaration', Priority.Highest],
  ['Declaration', Priority.Highest],
  /** Then, resolve imports */
  ['StyleImport', Priority.High],
  /** Then, register other items that can be "looked up" */
  ['Mixin', Priority.Medium],
  ['Ruleset', Priority.Medium],
  /** Then, resolve any calls */
  ['Call', Priority.Low]
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
    let evalCandidates: Array<[MixinEntry, number]>;
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
    /**
     * Check named and positional arguments
     * against mixins, to see which ones match.
     * (Any mixin with a mis-match of
     * arguments fails.)
     */
    for (let i = 0; i < mixinLength; i++) {
      let mixin = mixinArr[i]!;
      let isPlainRule = isNode(mixin, 'Rules');
      let paramLength = isPlainRule ? 0 : (mixin as Mixin).value.params?.length ?? 0;
      if (!paramLength) {
        /** Exit early if args were passed in, but no args are possible */
        if (args.length) {
          continue;
        }
        mixinCandidates.push(mixin);
      } else {
        /** The mixin has parameters, so let's check args to see if there's a match */
        let params = (mixin as Mixin).value.params!.copy(true);
        let positions = params.length;
        let requiredPositions = 0;
        for (let param of params.value) {
          if (isNode(param, 'VarDeclaration')) {
            if (param.value.value instanceof Nil) {
              requiredPositions++;
            }
          } else if (isNode(param, 'Any') && param.options.role === 'property') {
            // Any with role: 'property' is a parameter without default (consistent with variable names)
            requiredPositions++;
          } else if (!isNode(param, 'Rest')) {
            requiredPositions++;
          }
        }
        let argPos = 0;
        let match = true;
        for (let i = 0; i < positions; i++) {
          let arg = args[argPos];
          if (!arg) {
            continue;
          }
          let param: Node | undefined;
          if (isNode(arg, 'VarDeclaration')) {
            param = params.value.find(
              (p, i) => {
                if (isNode(p, 'VarDeclaration')) {
                  return p.value.name.valueOf() === arg.value.name.valueOf();
                }
                if (isNode(p, 'Any') && p.options.role === 'property') {
                  return p.valueOf() === arg.value.name.valueOf();
                }
                return false;
              }
            );
            if (param) {
              // Evaluate the argument value before assigning it to the parameter
              arg = await cast(arg.value.value).eval(thisContext);
            }
          } else {
            param = params.value[i];
            // Evaluate the argument before assigning it to the parameter
            // This ensures that references (e.g., ref({ key: 'color' })) are resolved
            arg = await cast(arg).eval(thisContext);
          }
          if (!param) {
            match = false;
            break;
          }
          if (isNode(param, 'VarDeclaration')) {
            param.value.value = arg;
          } else if (isNode(param, 'Any') && param.options.role === 'property') {
            // Convert Any with role: 'property' to VarDeclaration for registration
            const varDecl = new VarDeclaration({
              name: param as Any<'property'>,
              value: arg
            });
            params.value[i] = varDecl;
          } else if (isNode(param, 'Rest')) {
            param.value = spaced(args.slice(argPos));
            /** Check a pattern-matching node */
          } else if (param.compare(arg) !== 0) {
            /** This mixin is not a match */
            match = false;
            break;
          }
          argPos++;
        }
        /**
         * Now we can check remaining positional matches
         * against the remaining parameters.
         */
        if (argPos < requiredPositions) {
          /** This mixin is not a match */
          continue;
        }
        if (match) {
          (mixin as Mixin).value.params = params;
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
    evalCandidates = mixinCandidates
      .filter((candidate) => {
        const inStack = thisContext.rulesEvalStack.includes(candidate.value.rules.sourceNode as Rules);
        return !inStack;
      })
      .map<[MixinEntry, number]>(
        (candidate, i) => {
          let isDefault = candidate.options?.hasDefault;
          if (isDefault) {
            if (hasDefault) {
              throw new Error('Ambiguous use of default guard found');
            }
            hasDefault = true;
          }
          return [candidate, i];
        });

    if (hasDefault) {
      /** There is a default guard, so sort candidates */
      evalCandidates = evalCandidates.slice(0).sort((a, b) => {
        let aNode = a[0];
        let bNode = b[0];
        let aDefault = aNode.options?.hasDefault;
        let bDefault = bNode.options?.hasDefault;
        /** No guard (or is just a plain ruleset) */
        if (!aDefault && !bDefault) {
          return 0;
        }

        if (!aDefault) {
          return 1;
        }
        if (!bDefault) {
          return -1;
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
    let hasMatch = false;
    let outputRules: Array<[Rules, number]> = [];
    for (let [candidate, i] of evalCandidates) {
      if (isNode(candidate, 'Ruleset')) {
        const rules = await (candidate as Ruleset).value.rules.copy(true).eval(thisContext);
        hasMatch = true;
        // Skip empty Rules (e.g., containing only invisible nodes like comments)
        outputRules.push([rules, i]);
        continue;
      }
      let rules = candidate.value.rules;
      /** Create new rules, and add the candidate rules, to add to scope */
      rules = rules.copy(true);
      // Preserve the parent from the original mixin's Rules so lookups can traverse up
      // The parent should be where the mixin was defined (source position)
      // CRITICAL: We need the parent for variable lookup, but we must avoid cycles.
      // If the original parent equals the current rulesContext, setting it would create a cycle
      // because we're about to set thisContext.rulesContext = rules (line 1615)
      if (candidate.value.rules.parent && candidate.value.rules.parent !== thisContext.rulesContext) {
        rules.parent = candidate.value.rules.parent;
      }

      /** Now we need to add our parameters, if any */
      let params = candidate.value.params;
      if (params) {
        for (let i = 0; i < params.value.length; i++) {
          let param = params.value[i]!;
          if (isNode(param, 'Rest')) {
            // Rest parameters need to be converted to VarDeclaration for registration
            // Auto-generate a name if Rest doesn't have one (Less allows unnamed rest params)
            let restName: string;
            if (typeof param.value === 'string') {
              restName = param.value;
            } else {
              // Auto-generate name: "rest", "rest1", "rest2", etc. based on position
              // Check if there are other rest params to avoid conflicts
              let restCount = 0;
              for (let j = 0; j < i; j++) {
                const p = params.value[j]!;
                if (isNode(p, 'Rest')) {
                  restCount++;
                }
              }
              restName = restCount === 0 ? 'rest' : `rest${restCount + 1}`;
            }

            // Convert Rest to VarDeclaration so it can be registered and referenced
            // The Rest's value (list of remaining arguments) was already set during matching
            // Ensure param.value is a Node (it should be a Sequence/List from spaced())
            const restValue = isNode(param.value)
              ? param.value
              : (param.value ? new Any(String(param.value)) : new Nil());
            const restVarDecl = new VarDeclaration({
              name: new Any(restName, { role: 'property' }),
              value: restValue
            }, { paramVar: true });

            // Replace Rest with VarDeclaration in params
            params.value[i] = restVarDecl;
            param = restVarDecl;
          }

          if (isNode(param, 'VarDeclaration')) {
            // Adopt the param to set parent relationship, then register
            rules.adopt(param);
            // Parameters aren't in rules.value, so they don't get an index automatically
            // Assign negative indices so they're conceptually "before" the rules and found first
            if (param.index === undefined) {
              // Use negative indices starting from -1, -2, etc. so they sort before regular rules
              param.index = -(i + 1);
            }
            rules.registerNode(param);
          }
          // Note: Any with role: 'property' should have been converted to VarDeclaration during matching
          // If we see one here, it's an error - params should all be VarDeclaration by now
        }
        rules.register('declaration', new VarDeclaration({
          name: new Any('arguments', { role: 'property' }),
          value: new List(params.value.map((p) => {
            if (isNode(p, 'VarDeclaration')) {
              return p.value.value;
            }
            if (isNode(p, 'Any') && p.options.role === 'property') {
              // Should have been converted, but handle just in case
              return new Nil();
            }
            // Rest should have been converted to VarDeclaration by now
            return p;
          }))
        }));
      }
      /** Now we can evaluate our guards, if any */
      let guard: Condition | Bool | undefined = candidate.value.guard?.copy(true);
      let passes = true;
      let rulesContext = thisContext.rulesContext;
      // Store the call site position for call-time resolution
      // The call site is where rulesContext is (the parent rules containing the mixin call)
      let callSiteIndex = rulesContext?.index;
      thisContext.rulesContext = rules;
      if (callSiteIndex !== undefined) {
        thisContext.callSiteIndex = callSiteIndex;
      }
      if (guard) {
        guard.parent = rules;
        /** Allow lookup on the inherited rules */
        passes = false;
        /** All nodes need context to be evaluated */
        thisContext.isDefault = !hasMatch;
        guard = await guard.eval(thisContext);
        /** The guard condition passed */
        if (guard.value) {
          passes = true;
        }
      }
      if (!passes) {
        continue;
      }
      // Check for recursion: if this mixin is already in searchScope, skip it
      // to prevent infinite loops (e.g., .recursion { .recursion(); })
      // Uses the same mechanism as variable recursion detection
      if (thisContext.searchScope.has(candidate)) {
        // Recursive call detected - skip this candidate (don't add to outputRules)
        // This allows other candidates to still match
        continue;
      }

      // Mark this mixin as being evaluated (similar to how variables are tracked)
      thisContext.searchScope.add(candidate);
      try {
        let newRules = await rules.eval(thisContext);
        /**
         * Make everything public, so that we can access these
         * variables in the parent scope, or when doing lookups.
         */
        newRules.options.rulesVisibility = {
          Ruleset: 'public',
          Declaration: 'public',
          VarDeclaration: 'public',
          Mixin: 'public'
        };
        outputRules.push([newRules, i]);
      } catch (error) {
        // If recursion was detected (ReferenceError), skip this candidate
        // This allows other candidates to still match
        if (error instanceof ReferenceError && (error as any).message?.includes('Recursive mixin call')) {
          // Skip this candidate - recursion detected
          continue;
        }
        // Re-throw other errors
        throw error;
      } finally {
        // Remove from searchScope when done (allows re-evaluation in different contexts)
        thisContext.searchScope.delete(candidate);
        thisContext.searchScope.delete(rules);
      }

      // thisContext.rulesContext = rulesContext;
      // Restore call site index (or clear it if we're exiting the mixin)
      if (rulesContext) {
        thisContext.callSiteIndex = rulesContext.index;
      } else {
        thisContext.callSiteIndex = undefined;
      }
    }

    /**
     * Now that we have output rules, we sort them by
     * their original order
     */
    let rulesArr = outputRules
      .sort((a, b) => a[1] - b[1])
      .map(r => r[0]);
    /** Create a rules wrapper - but optimize to avoid unnecessary nesting */
    let output: Rules;
    if (rulesArr.length === 1) {
      output = rulesArr[0]!;
    } else {
      // Multiple items - spread their values into a new Rules
      const flattened: Node[] = [];
      for (const item of rulesArr) {
        flattened.push(...item.value.filter(r => r.visible));
      }
      output = new Rules(flattened);
    }

    /** Since this is a wrapper, and rules are all evaluated, consider it evaluated */
    output.preEvaluated = true;
    output.evaluated = true;
    /** Now push all rules into the rules value */
    if (this instanceof Context) {
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