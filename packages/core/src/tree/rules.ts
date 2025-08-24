import {
  Node,
  defineType,
  type NodeOptions,
  type LocationInfo,
  type TreeContext
} from './node';
import { Context } from '../context';
import { isNode } from './util/is-node';
import { cast } from './util/cast';
import { type Ruleset, type RulesetValue } from './ruleset';
import { type Mixin } from './mixin';
import { Interpolated } from './interpolated';
import type { Selector } from './selector';
import { spaced, Sequence } from './sequence';
import { type PrintOptions, getPrintOptions } from './util/print';

import { atIndex } from './util/collections';
import isPlainObject from 'lodash-es/isPlainObject';
import type { Condition } from './condition';
import type { Bool } from './bool';
import * as Registries from './util/registry-utils';
import { tryExtendSelector } from './util/extend';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';

const { isArray } = Array;
const DEBUG_FINAL_NL = typeof process !== 'undefined' && (process.env as any)?.JESS_DEBUG_FINAL_NL === '1';

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
      for (let i = this.rulesIndexed; i < this.value.length; i++) {
        const node = this.value[i]!;
        this.registerNode(node);
      }
      this.rulesIndexed = this.value.length;
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

  /**
   * This wrapper is used so we don't prematurely create a registry
   * just to search it.
   */
  find(type: 'ruleset', keys: string | string[] | Set<string>, filterType?: string, options?: Registries.FindOptions): ReturnType<Registries.RulesetRegistry['find']> | undefined;
  find(type: 'declaration', keys: string, filterType?: string, options?: Registries.DeclarationFindOptions): ReturnType<Registries.DeclarationRegistry['find']> | undefined;
  find(type: 'mixin', keys: string | string[], filterType?: string, options?: Registries.FindOptions): ReturnType<Registries.MixinRegistry['find']> | undefined;
  find(type: 'function', keys: string, filterType?: string, options?: Registries.FindOptions): ReturnType<Registries.FunctionRegistry['find']> | undefined;
  find(
    type: 'ruleset' | 'declaration' | 'mixin' | 'function',
    keys: string | string[] | Set<string>,
    filterType?: string,
    options: Registries.FindOptions = {}
  ): ReturnType<Registries.RulesetRegistry['find']> | ReturnType<Registries.DeclarationRegistry['find']> | ReturnType<Registries.MixinRegistry['find']> | ReturnType<Registries.FunctionRegistry['find']> | undefined {
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
    return (registry as any).find(keys, filterType, options);
  }

  override toString(options?: PrintOptions): string {
    if (!this.visible && !this.renderInvisible) {
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
    const depth = options.depth ?? 0;
    if (depth === 0 && DEBUG_FINAL_NL) {
      const rootPostPreview = w.capture(() => this.processPrePost('post', '', options));
      const last = [...this.value].reverse().find(n => n.visible);
      const lastPostPreview = last ? w.capture(() => last.processPrePost('post', '', options)) : '';
      console.error('[jess:final-nl]', {
        rootPostType: typeof this.post,
        rootPostPreview,
        lastType: last?.type,
        lastPostPreview
      });
    }
    // If no explicit Rules.post at root, propagate last child's post
    if (depth === 0 && (this.post === 0 || this.post === undefined)) {
      const last = [...this.value].reverse().find(n => n.visible);
      if (last) {
        last.processPrePost('post', '', options);
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
  toBraced(depth: number = 0, options?: PrintOptions) {
    options = getPrintOptions({ ...options, depth });
    const w = options.writer!;
    const mark = w.mark();
    let space = ''.padStart((depth) * 2);
    w.add('{');
    // emit body at increased depth; start with a single newline, body handles indent
    const childOptions = { ...options, depth: depth + 1 } as PrintOptions;
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
    const depth = options.depth ?? 0;
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
      n.toTrimmedString({ ...options, writer: w, depth } as PrintOptions);
      if (n.requiredSemi && n.options.semi !== false) {
        w.add(';');
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

  registerNode(node: Node, options?: Record<string, any>) {
    if (isNode(node, 'Rules')) {
      let rulesVisibility = options?.rulesVisibility ?? node.options.rulesVisibility ?? {};

      /** These are public by default */
      rulesVisibility.Declaration ??= 'public';
      rulesVisibility.Ruleset ??= 'public';

      /** Either one set as readonly will win */
      let readonly = Boolean(options?.readonly || node.options.readonly);
      this.rulesSet.push({
        node,
        rulesVisibility,
        readonly
      });
    } else if (isNode(node, 'Declaration')) {
      /**
       * setDefined works like Sass's !default flag - it finds the original variable
       * declaration and inserts a new declaration at the same rules level as the
       * found variable, but before the current nested node.
       */
      if (node.options?.setDefined) {
        // Skip setDefined logic if we're currently indexing to avoid recursive calls
        if (this._indexing) {
          console.log(`[setDefined] Skipping setDefined during indexing for '${node.value.name?.toString()}'`);
          // We'll handle setDefined after indexing is complete
          return;
        }

        let key = node.value.name?.toString();
        console.log(`[setDefined] Looking for variable '${key}' to set`);
        /** Don't set within sibling rules */
        let opts: Registries.FindOptions = {};
        opts.searchParents = true;
        opts.start = node.index;
        console.log(`[setDefined] Search options: searchParents=${opts.searchParents}, start=${opts.start}`);
        let result = this.find('declaration', key, node.type as 'Declaration', opts);
        console.log(`[setDefined] Find result for '${key}': ${result ? 'found' : 'not found'}`);
        if (result) {
          if (result.options?.readonly || opts.readonly) {
            throw new ReferenceError(`"${key}" is readonly`);
          }

          // Find the Rules node that contains the found declaration
          let foundRules: Rules | undefined;
          let current: Node | undefined = result;
          while (current && !isNode(current, 'Rules')) {
            current = current.parent;
          }
          foundRules = current as Rules;

          if (!foundRules) {
            throw new Error(`Could not find parent Rules for declaration '${key}'`);
          }

          console.log(`[setDefined] Found parent Rules for '${key}', registering new declaration`);

          // Create a new declaration with the same name but our value
          const newDeclaration = node.copy();
          newDeclaration.options = { ...newDeclaration.options };
          newDeclaration.options.setDefined = undefined; // Remove setDefined flag

          // Instead of inserting into the array, just register it in the registry
          // This way the original declaration keeps its position and index
          // Assign the new declaration an index that comes after the setDefined declaration
          // so that only lookups from after the setDefined position will see the new value
          const originalIndex = result.index;
          const currentIndex = node.index;
          const newIndex = currentIndex + 1; // Just after the setDefined declaration
          newDeclaration.index = newIndex;

          foundRules.register('declaration', newDeclaration);

          console.log(`[setDefined] Successfully registered new declaration for '${key}'`);
        } else {
          throw new ReferenceError(`"${key}" is not defined`);
        }
      }

      /**
       * Handle conditional assignment (?:) - only register if variable doesn't exist
       */
      if (node.options?.assign === '?:') {
        let key = node.value.name?.toString();
        let opts: Registries.FindOptions = {};
        opts.searchParents = true;
        let result = this.find('declaration', key, node.type as 'Declaration', opts);
        if (result) {
          /** Variable already exists, skip registering this declaration */
          return;
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
    node.parent = this;
    this.value.push(node);
    this.registerNode(node);
  }

  at(index: number) {
    return atIndex(this.value, index);
  }

  /**
   * Pre-evaluation phase that ensures all nodes are visited and indexed.
   * This traverses deeply to visit all nodes, but indexes locally.
   */
  override preEval(context: Context) {
    if (!this.preEvaluated) {
      let rules = this.maybeClone(context);
      rules.preEvaluated = true;

      // Assign index to this rules node if not already set
      if (rules.index === undefined) {
        rules.index = context.ruleCounter++;
      }

      // PreEval all nodes and register them after name resolution
      for (let i = 0; i < rules.value.length; i++) {
        const node = rules.value[i]!;

        // Assign index and set up parent relationship
        if (node.index === undefined) {
          node.index = context.ruleCounter++;
        }

        // Always call preEval to ensure deep traversal and name resolution
        const result = node.preEval(context);
        if (isThenable(result)) {
          // Handle async preEval by returning a promise that resolves after all children
          return result.then((resolvedNode) => {
            // Update the node if preEval returned a different instance
            if (resolvedNode !== node) {
              rules.value[i] = resolvedNode;
              resolvedNode.parent = rules;
            }

            // Register the node after preEval (name resolution)
            rules.registerNode(resolvedNode);
            if (resolvedNode.type === 'Ruleset') {
              context.treeRoot?.register('ruleset', resolvedNode as Ruleset<RulesetValue>);
            }

            // Continue with the rest of the children
            return this._preEvalRemainingChildren(rules, context, i + 1);
          });
        }

        // Update the node if preEval returned a different instance
        if (result !== node) {
          rules.value[i] = result;
          result.parent = rules;
        }

        // Register the node after preEval (name resolution)
        rules.registerNode(result);
        if (result.type === 'Ruleset') {
          context.treeRoot?.register('ruleset', result as Ruleset<RulesetValue>);
        }
      }

      return rules;
    }
    return this;
  }

  /**
   * Helper method to continue preEval'ing remaining children after an async preEval.
   */
  private _preEvalRemainingChildren(rules: Rules, context: Context, startIndex: number): MaybePromise<this> {
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
            resolvedNode.parent = rules;
          }

          // Register the node after preEval (name resolution)
          rules.registerNode(resolvedNode);
          if (resolvedNode.type === 'Ruleset') {
            context.treeRoot?.register('ruleset', resolvedNode as Ruleset<RulesetValue>);
          }

          // Continue with the rest of the children
          return this._preEvalRemainingChildren(rules, context, i + 1);
        });
      }

      // Update the node if preEval returned a different instance
      if (result !== node) {
        rules.value[i] = result;
        result.parent = rules;
      }

      // Register the node after preEval (name resolution)
      rules.registerNode(result);
      if (result.type === 'Ruleset') {
        context.treeRoot?.register('ruleset', result as Ruleset<RulesetValue>);
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
    const priorities: Priority[] = Array.from({ length: Priority.Highest + 1 }).map((_, i) => (Priority.Highest - i) as Priority);
    const phaseRun = serialForEach(priorities, (p: Priority) => {
      const queue = evalQueue.get(p);
      if (!queue) {
        return;
      }
      const entries: Array<[number, [number, Node]]> = Array.from(queue.entries()) as any;
      return serialForEach(entries, ([q, item]: [number, [number, Node]]) => {
        const [idx, rule] = item;
        /** Var declarations have late evaluation, so they are skipped. */
        if (isNode(rule, 'VarDeclaration')) {
          return;
        }
        const maybeResult = (rule as any).eval(context) as MaybePromise<Node>;
        const applyResult = (result: Node) => {
          if (result !== rule) {
            rules.value[idx] = result;
            queue[q] = [idx, result];
          }
          if (result.options.hoistToRoot) {
            rulesToHoist = true;
          }
        };
        if (isThenable(maybeResult)) {
          return (maybeResult as Promise<Node>).then(res => applyResult(res));
        }
        applyResult(maybeResult as Node);
        return;
      });
    });
    if (isThenable(phaseRun)) {
      return (phaseRun as Promise<void>).then(() => rulesToHoist);
    }
    return rulesToHoist;
  }

  /** Bubble hoisted rules to root frame if needed */
  private _bubbleHoistedRules(context: Context, rules: Rules, rulesToHoist: boolean, hadRoot: Rules | undefined) {
    let frame = context.rulesetFrames[0];
    if (!hadRoot || !frame || !rulesToHoist) {
      return;
    }
    let newRules = new Rules([]);
    const getRulesetCopy = () => {
      let newFrame = frame.copy(true);
      for (let n of newFrame.nodes()) {
        if (isNode((n.value as any).rules, 'Rules') && (n.value as any).rules.index === rules.index) {
          (n.value as any).rules = newRules;
          break;
        }
      }
      return newFrame;
    };
    let rootRules: Node[] = !rules.value[0]?.options.hoistToRoot ? [getRulesetCopy()] : [];
    for (let [i, rule] of rules) {
      if (!rule.options.hoistToRoot) {
        newRules.push(rule);
      } else {
        rootRules.push(rule);
        let next = atIndex(rules.value, i + 1);
        if (next && !next.options.hoistToRoot) {
          newRules = new Rules([]);
          rootRules.push(getRulesetCopy());
        }
      }
    }
    let prevFrameIndex = hadRoot.value.indexOf(frame);
    hadRoot.value.splice(prevFrameIndex, 1, ...rootRules);
  }

  override evalNode(context: Context): MaybePromise<this> {
    const saved = this._snapshotContext(context);
    return pipe(
      () => {
        this._setupContextForRules(context, this);

        // First, preEval to index and register all nodes
        const preEvalResult = this.preEval(context);
        if (isThenable(preEvalResult)) {
          return preEvalResult.then((rules) => {
            const evalQueue = this._buildEvalQueue(rules);
            const maybeHoist = this._evaluateQueue(rules, evalQueue, context);
            if (isThenable(maybeHoist)) {
              return (maybeHoist as Promise<boolean>).then(rulesToHoist => ({ rules, rulesToHoist }));
            }
            return { rules, rulesToHoist: maybeHoist as boolean };
          });
        }

        // Synchronous preEval
        const rules = preEvalResult;
        const evalQueue = this._buildEvalQueue(rules);
        const maybeHoist = this._evaluateQueue(rules, evalQueue, context);
        if (isThenable(maybeHoist)) {
          return (maybeHoist as Promise<boolean>).then(rulesToHoist => ({ rules, rulesToHoist }));
        }
        return { rules, rulesToHoist: maybeHoist as boolean };
      },
      ({ rules, rulesToHoist }: { rules: Rules; rulesToHoist: boolean }) => {
        if (rules === context.root) {
          /**
           * We've evaluated all the rules of the "outer" rules
           * and we can now resolve any pending extends.
           *
           * We need to loop through all roots, but we need to properly respect
           * import scoping, so this isn't correct yet.
           */
          for (let root of context.allRoots) {
            for (let [find, extendWith, partial] of root.pendingExtends) {
              let rulesetSet = root.find('ruleset', find.keySet);
              if (rulesetSet) {
                rulesetSet.forEach((ruleset) => {
                  let result = tryExtendSelector(ruleset.selector as Selector, find, extendWith, partial);
                  if (result) {
                    /** Just extend it? */
                    ruleset.value.selector = result.value;
                  }
                });
              }
            }
          }
        }
        this._bubbleHoistedRules(context, rules, rulesToHoist, saved.root);
        /** Restore contexts */
        context.rulesContext = saved.rulesContext;
        context.treeRoot = saved.treeRoot;
        context.root = saved.root;
        return rules;
      }
    ) as MaybePromise<this>;
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
  /** Then, register other items that can be "looked up" */
  ['Mixin', Priority.High],
  ['Ruleset', Priority.High],
  /** Then, resolve imports */
  ['StyleImport', Priority.Medium],
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
    let thisContext = this instanceof Context ? this : new Context();
    /**
     * Check named and positional arguments
     * against mixins, to see which ones match.
     * (Any mixin with a mis-match of
     * arguments fails.)
     */
    let argEntries = isPlainObject(args[0]) ? Object.entries(args[0]) : null;
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
        let params = (mixin as Mixin).value.params!.clone();
        let positions = new Set(params.value.map((_, i) => i));
        /**
         * First argument can be a plain object with named params
         * e.g. { a: 1, b: 2 }
         */
        let argPos = 0;
        if (argEntries) {
          argPos = 1;
          let namedMap = new Map(argEntries);
          /**
           * We iterate through params instead of args,
           * because we need to track the position
           * of each parameter.
           */
          for (let [i, param] of params) {
            if (isNode(param, 'VarDeclaration')) {
              let key = String(param.value.name);
              let namedValue = namedMap.get(key);
              /** Replace our param value with the passed in named value */
              if (namedValue) {
                params.value[i] = cast(namedValue);
                /**
                 * Because we've assigned a named value, any
                 * positional arguments will be shifted.
                 */
                positions.delete(i);
                namedMap.delete(key);
              } else {
                /** This mixin is not a match */
                break;
              }
            }
          }
          if (namedMap.size) {
            /** This mixin is not a match */
            continue;
          }
        }
        /**
         * Now we can check remaining positional matches
         * against the remaining parameters.
         */
        if (args.length - argPos !== positions.size) {
          /** This mixin is not a match */
          continue;
        }
        let match = true;

        for (let i of positions) {
          let arg = args[argPos];
          let param = params.value[i]!;
          if (isNode(param, 'VarDeclaration')) {
            param.value.value = cast(arg);
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
      let rules = new Rules([]);
      rules.push(candidate.value.rules);

      /** Now we need to add our parameters, if any */
      let params = candidate.value.params;
      if (params) {
        for (let param of params.value) {
          if (isNode(param, ['VarDeclaration', 'Rest'])) {
            /** @todo - Register Rest */
            rules.register('declaration', param);
          }
        }
      }
      /** Now we can evaluate our guards, if any */
      let guard: Condition | Bool | undefined = candidate.value.guard;
      let passes = true;
      let incomingScope = thisContext.scope;
      thisContext.scope = rules;
      if (guard) {
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
        outputRules.push([newRules, i]);
      }
      thisContext.scope = incomingScope;
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