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
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
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
    return (registry as any).add(node);
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

  override toString(options?: PrintOptions): string {
    if (!this.visible && !this.fullRender) {
      return '';
    }
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    this.processPrePost('pre', '', options);
    const bodyMark = w.mark();
    const bodyStr = this.toTrimmedString(options);
    const bodyEmitted = w.getSince(bodyMark);
    if (bodyEmitted.length === 0 && bodyStr) {
      w.add(bodyStr);
    }
    const depth = options.frameState?.at(-1)?.depth ?? 0;
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
    super(value ?? [], options, location, treeContext);
  }

  * [Symbol.iterator]() {
    yield* this.value.entries();
  }

  /**
   * Used by Ruleset, Mixins, and AtRules etc to render
   * rules with braces.
   */
  toBraced(options?: PrintOptions) {
    let opts = getPrintOptions(options);
    let depth = opts.frameState?.at(-1)?.depth ?? 0;
    const w = opts.writer!;
    const mark = w.mark();
    let space = ''.padStart((depth) * 2);
    w.add('{');
    // emit body at increased depth; start with a single newline, body handles indent
    const childOptions = { ...options, frameState: [{ depth: depth + 1 }] } satisfies PrintOptions;
    childOptions.writer!.add('\n');
    this._emitRulesBody(childOptions);
    // ensure closing brace is on its own properly indented line
    w.add('\n');
    if (depth !== 0) {
      w.add(space);
    }
    w.add('}');
    return w.getSince(mark);
  }

  private _emitRulesBody(options: PrintOptions) {
    const w = options.writer!;
    const depth = options.frameState?.at(-1)?.depth ?? 0;
    const space = ''.padStart(depth * 2);
    const { value } = this;
    const items = value.filter(n => n.visible);

    if (items.length === 0) {
      return;
    }

    // No spacing flags; writer.capture is used where needed

    for (let idx = 0; idx < items.length; idx++) {
      const n = items[idx]!;
      if (idx > 0) {
        w.add('\n');
      }
      const isChildRules = n.type === 'Rules';
      if (!isChildRules && depth !== 0) {
        w.add(space);
      }

      // Emit directly to preserve source map segments
      let rule = w.capture(() => n.toTrimmedString({ ...options }));
      w.add(rule, n); // Pass node as origin to preserve location info
      if (n.requiredSemi && n.options.semi !== false) {
        w.add(';', n);
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
      this.register('mixin', node);
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

    for (let i = 0; i < rules.value.length; i++) {
      const node = rules.value[i]!;

      // Check if node has a static name (can be registered immediately)
      if (node.type === 'Any' && node.options.role === 'charset') {
        /** Special case where we register the charset node immediately */
        rules.value[i] = (node as Any).preEval(context);
      } else if (this._hasStaticName(node)) {
        staticNodes.push(node);
        this._registerNodeIfEligible(rules, node, context);
      } else {
        dynamicNodes.push(node);
      }
    }

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
      // After preEval, the selector should be resolved to static identifiers
      // Check if the selector is static (not the ruleset node itself)
      // If the ruleset has been preEvaluated, the selector should be static
      if (node.preEvaluated) {
        const selector = node.value.selector;
        // After preEval, selector is evaluated and should be static
        // Check if selector has F_STATIC flag, or if it's a basic selector (which is always static)
        if (selector && 'hasFlag' in selector && typeof selector.hasFlag === 'function') {
          return selector.hasFlag(F_STATIC);
        }
        // If selector doesn't have hasFlag, assume it's static after preEval
        // (preEval resolves names to static identifiers)
        return true;
      }
      // Before preEval, check if selector itself is static
      const selector = node.value.selector;
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
      context.treeRoot?.register('ruleset', node as Ruleset<RulesetValue>);
    }
  }

  /**
   * Multi-pass resolution of dynamic nodes with interpolated names
   */
  private _resolveDynamicNodes(rules: Rules, context: Context, saved: any, dynamicNodes: Node[]): MaybePromise<this> {
    const unresolvedNodes: Node[] = [...dynamicNodes];
    const resolvedNodes: Node[] = [];
    let firstError: Error | undefined;

    const attemptResolution = (): MaybePromise<this> => {
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
                context.treeRoot?.register('ruleset', resolvedNode as Ruleset<RulesetValue>);
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
            context.treeRoot?.register('ruleset', result as Ruleset<RulesetValue>);
            // Also register to rules itself to ensure it's in the local registry
            rules.register('ruleset', result as Ruleset<RulesetValue>);
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
          if (resolvedNode.type === 'Ruleset') {
            context.treeRoot?.register('ruleset', resolvedNode as Ruleset<RulesetValue>);
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
      if (result.type === 'Ruleset') {
        context.treeRoot?.register('ruleset', result as Ruleset<RulesetValue>);
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
      queue.push(item);
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

        let maybeResult: MaybePromise<Node>;
        try {
          maybeResult = (rule as any).eval(context) as MaybePromise<Node>;
        } catch (error) {
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

        const applyResult = (result: Node) => {
          if (result !== rule) {
            rules.value[idx] = result;
            queue[q] = [idx, result];
            // If a StyleImport evaluated to Rules, register them in the parent's _rulesSet
            // so variables from the import can be found by the parent
            if (isNode(result, 'Rules')) {
              // Set the index of the imported Rules to the StyleImport's index
              // so we can compare Rules indices when determining which variable was declared later
              result.index = idx;
              rules.registerNode(result, {
                rulesVisibility: result.options.rulesVisibility,
                readonly: result.options.readonly
              }, context);
            }
          }
          if (result.options.hoistToRoot) {
            rulesToHoist = true;
          }
        };
        if (isThenable(maybeResult)) {
          return (maybeResult as Promise<Node>).then((res) => {
            applyResult(res);
          }).catch((error) => {
            // Handle async errors - retry at lower priority if not already retried
            if (p > Priority.None && !retriedNodes.has(rule)) {
              retriedNodes.add(rule);
              // Move to lowest priority queue for retry
              const lowQueue = evalQueue.get(Priority.None) || [];
              lowQueue.push([idx, rule]);
              evalQueue.set(Priority.None, lowQueue);
              // Skip processing for now, will be retried at Priority.None
              // Return undefined to resolve the promise (error will be thrown on retry)
              return;
            }
            // If we're already at the lowest priority, rethrow
            throw error;
          });
        }
        applyResult(maybeResult as Node);
        return;
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
                  rulesetSet = found;
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
    let w = options.writer!;
    let mark = w.mark();
    let frameState = opts.frameState ??= [];
    opts.frameState = frameState;

    // If we have frames, we need to flatten
    let currentState = frameState.at(-1) ?? { depth: 0 };
    let currentDepth = currentState.depth;

    let newFrames: (AtRule | Ruleset)[] = currentNode.frames!.filter(frame => isNode(frame, 'AtRule')) as AtRule[];
    newFrames.push(currentNode);
    let newFramesStartIndex = 0;

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
    for (let i = 0; i < length; i++) {
      const child = rules.value[i]!;
      if (!child.visible) {
        continue;
      }

      let isHoistedChild = isNode(child, ['AtRule', 'Ruleset']) && child.frames;

      /** Skip over frames we're currently in */
      for (let i = 0; i < newFrames.length; i++) {
        if (newFrames[i] === frameState.at(i)?.frame) {
          newFramesStartIndex++;
        } else {
          break;
        }
      }

      if (isHoistedChild) {
        if (i !== 0) {
          /**
           * "close" all current open frames
           * up to any containing at-rules.
           */
          for (let d = frameState.length - 1; d >= 0; d--) {
            let space = ''.padStart(d * 2);
            let frame = frameState[d]!.frame;
            if (isNode(frame, 'AtRule')) {
              break;
            }
            let state = frameState.pop();
            if (!state?.frame) {
              break;
            }
            w.add(`${space}}\n`);
          }
        }
        child.toTrimmedString(opts);
        if (i < length - 1) {
          /** More declarations, we need to re-open */
          for (let d = newFramesStartIndex; d < newFrames.length; d++) {
            let frame = currentNode.frames![d];
            if (frame) {
              frameState.push({ frame, depth: d });
              frame.renderOpening(opts);
            }
          }
        }
      } else {
        let d = newFramesStartIndex;
        for (; d < newFrames.length; d++) {
          let frame = newFrames[d];
          if (frame) {
            frameState.push({ frame, depth: d });
            frame.renderOpening(opts);
          }
        }
        let space = ''.padStart(d * 2);
        w.add(space);

        let out = w.capture(() => child.toTrimmedString(opts));
        w.add(out);
        if (child.requiredSemi && child.options.semi !== false) {
          w.add(';');
        }
        w.add('\n');
      }
      if (i === length - 1) {
        /** No more declarations, close the frames we opened */
        for (let d = frameState.length - 1; d >= newFramesStartIndex; d--) {
          let space = ''.padStart(d * 2);
          let state = frameState.pop();
          if (!state?.frame) {
            break;
          }
          w.add(`${space}}\n`);
        }
      }
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
export type MixinEntry = Mixin | Rules;

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
              (p, i) => isNode(p, 'VarDeclaration') && p.value.name.valueOf() === arg.value.name.valueOf()
            );
            if (param) {
              arg = arg.value.value;
            }
          } else {
            param = params.value[i];
            arg = cast(arg);
          }
          if (!param) {
            match = false;
            break;
          }
          if (isNode(param, 'VarDeclaration')) {
            param.value.value = arg;
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

    /**
     * Now we have a set of mixins that can return rulesets,
     * but first we need to create a new scope for each mixin,
     * and create variable declarations for each parameter.
     */
    let hasMatch = false;
    let outputRules: Array<[Rules, number]> = [];
    for (let [candidate, i] of evalCandidates) {
      if (isNode(candidate, 'Rules')) {
        hasMatch = true;
        outputRules.push([candidate, i]);
        continue;
      }
      /** Create new rules, and add the candidate rules, to add to scope */
      let rules = candidate.value.rules.copy(true);

      /** Now we need to add our parameters, if any */
      let params = candidate.value.params;
      if (params) {
        for (let param of params.value) {
          if (isNode(param, ['VarDeclaration', 'Rest'])) {
            /** @todo - Register Rest */
            rules.register('declaration', param);
          }
        }
        rules.register('declaration', new VarDeclaration({
          name: new Any('arguments', { role: 'property' }),
          value: new List(params.value.map((p) => {
            if (isNode(p, 'VarDeclaration')) {
              return p.value.value;
            }
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
      if (passes) {
        let newRules = await rules.eval(thisContext);
        /**
         * Make everything public, so that we can access these
         * these variables in the parent scope, or when doing lookups.
         */
        newRules.options.rulesVisibility = {
          Ruleset: 'public',
          Declaration: 'public',
          VarDeclaration: 'public',
          Mixin: 'public'
        };
        outputRules.push([newRules, i]);
      }
      thisContext.rulesContext = rulesContext;
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
    let rulesArr = outputRules.sort((a, b) => a[1] - b[1]).map(r => r[0]);
    /** Create a rules wrapper */
    let output = new Rules(rulesArr);

    /** Now push all rules into the rules value */
    if (this instanceof Context) {
      return output;
    } else {
      return output.toObject();
    }
  }

  return returnFunc;
}