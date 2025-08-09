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
  eval(context: Context): Promise<this>;
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
    return (registry as any).find(keys, filterType, options);
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
    if (depth !== 0) w.add(space);
    w.add('}');
    return w.getSince(mark);
  }

  private _emitRulesBody(options: PrintOptions) {
    const w = options.writer!;
    const depth = options.depth ?? 0;
    const space = ''.padStart(depth * 2);
    const { value } = this;
    const items = value.filter(n => n.visible);
    if (items.length === 0) return;

    // Guard against stray pending-space affecting first child indent
    options.pendingSpaceBeforeNext = false;

    for (let idx = 0; idx < items.length; idx++) {
      const n = items[idx]!;
      // newline between rules (avoid doubling if already at line start)
      if (idx > 0 && (w as any)._column !== 0) {
        w.add('\n');
      }
      // always indent each child line by depth
      if (depth !== 0) w.add(space);
      // Ensure no pending-space leaks into indentation
      options.pendingSpaceBeforeNext = false;
      // Render child content without outer pre/post; parent controls line breaks
      const childOptions: PrintOptions = { writer: w, depth } as PrintOptions;
      n.toTrimmedString(childOptions);
      if (n.requiredSemi && n.options.semi !== false) {
        w.add(';');
      }
    }
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const depth = options.depth ?? 0;
    const mark = w.mark();
    this._emitRulesBody(options);
    let all = w.getSince(mark);
    if (depth === 0) {
      // Collapse accidental double newlines between rules
      all = all.replace(/\n{2,}/g, '\n');
      return all.replace(/[\n\s]*$/, '');
    }
    return all;
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

  /** @deprecated - Move to `register` */
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
       * `setDefined` is an immediate mutation of the last found instance
       *
       * @todo - This behavior needs to be changed to be aligned with Sass. It should not
       * mutate the last found instance, and instead should create a new declaration at
       * the same scope level as the original declaration, but just before where the
       * current evaluation is at the top level of the current scope.
       */
      if (node.options?.setDefined) {
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
          /** Over-write value */
          result.value.value = node.value.value.copy();
          /** !important always wins */
          let important = result.value.important || node.value.important;
          result.value.important = important;
        } else {
          throw new ReferenceError(`"${key}" is not defined`);
        }
      }
      this.register('declaration', node);
    }
  }

  push(node: Node) {
    node.parent = this;
    this.value.push(node);
    /** @todo - replace with `register` ? */
    this.registerNode(node);
  }

  at(index: number) {
    return atIndex(this.value, index);
  }

  /**
   * Unlike `eval`, preEval of rules within a Rules instance
   * happens linearly, which helps us assign sequential indexes
   * while traversing nested rules. The indexes will help us
   * when searching "upwards" (Sass-style).
   */
  override async preEval(context: Context): Promise<this> {
    if (!this.preEvaluated) {
      let rules = this.maybeClone(context);
      /**
       * Attach this early? Normally the parent will attach
       * but this causes recursion issues with rules.
       *
       * @todo - Should this be added to node.clone()? I need
       * to think about the implications.
       */
      rules.preEvaluated = true;
      if (rules.index === undefined) {
        rules.index = context.ruleCounter++;
      }
      for (let [, node] of rules) {
        if (node.index === undefined) {
          node.index = context.ruleCounter++;
        }
      }
      return rules;
    }
    return this;
  }

  override async evalNode(context: Context): Promise<this> {
    let rules = this;
    if (!this.preEvaluated) {
      rules = await this.preEval(context);
    }
    let evalQueue: EvalQueueMap = new Map();

    /** Grab current context */
    let rulesContext = context.rulesContext;
    let treeContext = context.treeContext;
    let treeRoot = context.treeRoot;
    let root = context.root;

    /** Set new context while evaluating */
    if (!treeContext || treeContext !== rules.treeContext) {
      /**
       * We've encountered a new tree root...
       * but this isn't the right way to manage this...
       *
       * We need a list of _unique_ tree context roots that are visible
       * from this root AND that are extendable.
       */
      context.allRoots.push(rules);
      context.treeContext = rules.treeContext;
      context.treeRoot = rules;
      /** Set this as ultimate root if there isn't a root yet */
      context.root ??= rules;
    }
    context.rulesContext = rules;

    // let { leakVariablesIntoScope } = context.treeContext ?? {}
    /**
     * First, push rules onto an evaluation queue.
     */
    for (let item of rules) {
      let [, rule] = item;
      let priority = NodeTypeToPriority.get(rule.type) ?? Priority.None;
      let queue = evalQueue.get(priority) ?? [];
      queue.push(item);
      evalQueue.set(priority, queue);
    }

    let rulesToHoist = false;

    /** Now, evaluate the queue in two rounds */
    for (let method of ['preEval', 'eval'] as const) {
      for (let i: Priority = Priority.Highest; i >= 0; i--) {
        let queue = evalQueue.get(i);
        if (!queue) {
          continue;
        }
        for (let item of queue) {
          let [i, rule] = item;
          if (
            i === Priority.Highest
            && method === 'preEval'
            && isNode(rule, 'Declaration')
            && rule.value.name instanceof Interpolated
          ) {
            let lowQueue = evalQueue.get(Priority.High) ?? [];
            lowQueue.push([i, rule]);
            evalQueue.set(Priority.High, lowQueue);
            continue;
          }
          /** Only evaluated on reference */
          if (method === 'eval' && isNode(rule, 'VarDeclaration')) {
            continue;
          }
          let result!: Node;
          result = await rule[method](context);
          if (result !== rule) {
            rules.value[i] = result;
            queue[i] = [i, result];
          }
          if (method === 'eval' && result.options.hoistToRoot) {
            rulesToHoist = true;
          }
          if (method === 'preEval') {
            /** Do I need to pass in options? */
            rules.registerNode(result);
          } else if (method === 'eval') {
            /** Register rulesets for extending */
            let rulesetType = isNode(result, 'Ruleset')
              ? 'Ruleset'
              : isNode(result, 'Mixin')
                ? 'Mixin'
                : undefined;
            if (rulesetType === 'Ruleset') {
              /**
               * We register it at the tree root for extends,
               * because extends is a global (file-level) operation.
               *
               * We also register it at the ruleset for mixin lookup.
               *
               * @todo - fix ruleset type so Ruleset<unknown>
               */
              context.treeRoot.register('ruleset', result as Ruleset<RulesetValue>);
            }
            if (rulesetType) {
              context.treeRoot.register('mixin', result as Mixin);
            }
          }
          /**
           * @todo - Figure out if I should try to evaluate again later?
           * I had this in a try/catch block, but it had hard-to-reason about
           * behavior.
          */
          // if (i === Priority.None) {
          //   throw e
          // }
          // let lowQueue = rules.evalQueue.get(Priority.None) ?? new Queue()
          // lowQueue.push([i, rule])
          // rules.evalQueue.set(Priority.None, lowQueue)
          /** Register in an index - skip declarations already registered */

          // rules.data.setAt(i, rule)
        }
      }
    }
    /** Bubble any hoisted rules */
    let frame = context.rulesetFrames[0];
    if (root && frame && rulesToHoist) {
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
      let prevFrameIndex = root.value.indexOf(frame);
      /** Splice the new rules where that frame was */
      root.value.splice(prevFrameIndex, 1, ...rootRules);
    }
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
    /**
     * Restore contexts
     */
    context.rulesContext = rulesContext;
    context.treeRoot = treeRoot;
    context.root = root;
    return rules;
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
type MixinEntry = Mixin | Rules;

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