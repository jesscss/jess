/* eslint-disable @typescript-eslint/prefer-readonly */
import {
  Node,
  defineType,
  type NodeOptions,
  type LocationInfo,
  type TreeContext
} from './node'
import {
  Declaration
} from './declaration'
import {
  type VarDeclaration
} from './var-declaration'
import type { Context } from '../context'
import { isNode } from './util'
import { type Ruleset } from './ruleset'
import { type Mixin } from './mixin'
import { Interpolated } from './interpolated'
import type { Selector } from './selector'

export const enum Priority {
  None = 0,
  Low = 1,
  Medium = 2,
  High = 3,
  Highest = 4
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
  rulesVisibility?: Record<string, 'public' | 'optional' | 'private'>
  readonly?: boolean
  /** all imports other than classic `@import` set returned rules to local */
  local?: boolean
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
  type = 'Rules'
  shortType = 'rules'
  override allowRuleRoot = true
  override allowRoot = true

  constructor(
    value: Node[],
    options?: RulesOptions & NodeOptions,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    super(value ?? [], options, location, treeContext)
  }

  * [Symbol.iterator]() {
    yield * this.value.entries()
  }

  override toTrimmedString(depth: number = 0) {
    let space = ''.padStart(depth * 2)
    let output = ''
    let { value } = this
    let outputs = value
      .map((n, i) => {
        let initial = n.toString(depth, i === 0 && depth !== 0 ? '\n' : undefined)
        if (n.requiredSemi && n.options.semi !== false && value.length >= i) {
          initial += ';'
        }
        return initial.replace(/^(\n?)[ \t]*/, `$1${space}`)
      })
    output += outputs
      .join('')
      /**
       * Replace multiple newlines with single newlines
       * (Remove empty lines)
       */
      .replace(/\n+/g, '\n')
    return output
  }

  visibleRules() {
    return this.value.filter(n => n.visible)
  }

  // assign(map: QueueMap, key: Priority, value: Node, pos: number, nameOnly?: true | undefined) {
  //   let set = map.get(key)
  //   if (set) {
  //     set.add({ node: value, pos, nameOnly })
  //   } else {
  //     map.set(key, new Set([{ node: value, pos, nameOnly }]))
  //   }
  // }

  // async evalNodeOld(context: Context): Promise<Rules | Root> {
  //   let inheritedScope = context.scope
  //   context.scope = this.scope
  //   let { leakVariablesIntoScope } = context.treeContext
  //   let rules = this.clone()
  //   rules.scope = this.scope
  //   let assign = this.assign
  //   /**
  //    * Make a shallow copy of rules.
  //    * This is because we're going to replace
  //    * each item in the array when evaluating.
  //    */
  //   rules.value = [...this.value]
  //   let evalQueue: QueueMap = new Map()

  //   /**
  //    * First, create a linked list.
  //    * This is so folding in mixins can be done
  //    * without mutating arrays.
  //    */
  //   // let prev: Node | undefined
  //   // let nodeLength = ruleValues.length
  //   /** Iterate in reverse order, to assign the _next node */
  //   // for (let i = nodeLength - 1; i >= 0; i--) {
  //   //   const n = value[i]
  //   //   if (i === nodeLength - 1) {
  //   //     this._last = n
  //   //   }
  //   //   if (i === 0) {
  //   //     this._first = n
  //   //   }
  //   //   if (prev) {
  //   //     n._next = prev
  //   //   }
  //   //   prev = n
  //   // }

  //   /**
  //    * Assign to the evaluation queue.
  //    *
  //    * Evalution order (in Less) should go:
  //    *   1. static declaration names (names that do not, themselves,
  //    *      contain variables). This includes mixin and qualified rule names
  //    *   2. variable declaration names
  //    *   3. mixin and function calls
  //    *   3. everything else (declaration values, etc.)
  //    *
  //    * Everything else:
  //    *   1. static declaration names of mixins and functions
  //    *   2. variable declaration names of mixins and functions
  //    *   3. everything else
  //    */
  //   for (let [i, n] of rules) {
  //     /** Evaluate names */
  //     if (n instanceof Declaration || n instanceof Mixin) {
  //       const { name } = n.value

  //       if (name instanceof Node) {
  //         if (name instanceof Interpolated) {
  //           /** Evaluate these names after evaluating static names */
  //           assign(evalQueue, Priority.Medium, n, i, true)
  //         } else {
  //           /** Evaluate static names first */
  //           assign(evalQueue, Priority.High, n, i, true)
  //         }
  //       }
  //     /**
  //      * Hoist imports
  //      *
  //      * @note - this might need tweaking
  //      */
  //     } else if (isNode(n, 'Import')) {
  //       assign(evalQueue, Priority.Low, n, i)
  //     } else {
  //       assign(evalQueue, Priority.None, n, i)
  //     }
  //   }

  //   /** Start with high priority */
  //   for (let i: Priority = Priority.High; i >= 0; i--) {
  //     let set = evalQueue.get(i)
  //     if (!set) {
  //       continue
  //     }

  //     for (let item of set) {
  //       const { node, pos, nameOnly } = item
  //       if (nameOnly) {
  //         let decl = node.clone() as Declaration
  //         /** Everything in a ruleset root will have a name */
  //         let name = decl.value.name
  //         let ident: string
  //         if (name instanceof Node) {
  //           ident = (await name.eval(context)).value
  //           decl.value.name = ident
  //         } else {
  //           ident = name
  //         }
  //         if (!decl.allowRuleRoot) {
  //           decl.visible = false
  //         }
  //         rules.data.setAt(pos, decl)

  //         // if (isNode(decl, 'Mixin')) {
  //         //   this._scope.setMixin(ident, decl, decl.options)
  //         // } else if (isNode(decl, ['VarDeclaration', 'Func'])) {
  //         //   this._scope.setVar(ident, decl, decl.options as VarDeclarationOptions)
  //         // } else {
  //         //   this._scope.setProp(ident, decl as Declaration)
  //         // }
  //         /**
  //          * Now that we've evaluated the name, add it to the evaluation queue.
  //          * (Variable values are not evaluated unless they are called)
  //          */
  //         if (!(decl instanceof VarDeclaration)) {
  //           assign(evalQueue, Priority.None, decl, i)
  //         }
  //       } else {
  //         /** Variable values are only evaluated if referenced */
  //         if (!(node instanceof VarDeclaration)) {
  //           if (node instanceof Declaration) {
  //             /**
  //              * We've already cloned and partially evaluated this,
  //              * so we only need to evaluate the value.
  //              */
  //             context.declarationScope.push(node)
  //             let evaldValue = await node.data.get('value').eval(context)
  //             context.declarationScope.pop()

  //             /**
  //              * If the eval'd value of the declaration is Nil, effectively
  //              * remove the declaration from the ruleset by setting the entire
  //              * declaration to Nil.
  //              *
  //              * @todo - Is this correct? I'm not sure this is correct.
  //              */
  //             if (evaldValue instanceof Nil) {
  //               rules.data.setAt(pos, evaldValue)
  //             } else {
  //               /** Else set the value only of the (declaration) node */
  //               node.data.set('value', evaldValue)
  //             }
  //           } else {
  //             /**
  //              * Not a VarDeclaration and not a declaration.
  //              * What is it?
  //              */
  //             let result = await node.eval(context)

  //             if (!result.allowRuleRoot) {
  //               result.visible = false
  //             }
  //             if (result instanceof Rules) {
  //               /** @todo Push inherited prop / ruleset references into parent scope */
  //               // let returnRules = result.data.list
  //               // if (leakVariablesIntoScope) {
  //               //   rules.data.list.splice(pos, 1, ...returnRules)
  //               // } else {
  //               //   returnRules = returnRules.filter((current, i) => {

  //               //   })
  //               // }

  //             } else {
  //               // rules.data.set(ROOT_DATA, result, pos)
  //             }

  //             /** Merge any scope that we need for lookups */
  //             // if (result instanceof Rules) {
  //             //   this._scope.merge(result._scope, leakVariablesIntoScope)
  //             // }
  //           }
  //         }
  //       }
  //     }
  //   }

  //   // let current = map[0]
  //   // let prevEvald: Node | undefined

  //   /**
  //      * This will dynamically link rulesets like
  //      * [rule]._next = [ruleset]._first
  //      * [ruleset]._last = [rule]._next._next
  //      *
  //      * @todo Register declarations for languages
  //      *       that merge them in.
  //      */
  //   // while (current) {
  //   //   let evald: Node

  //   //   if (current.nameOnly) {
  //   //     const decl = current.node.clone() as Declaration<Node>
  //   //     decl.name = decl.name.eval(context)
  //   //     evald = decl
  //   //   } else {
  //   //     evald = current.node.eval(context)
  //   //   }
  //   //   const evaldIsRules = evald instanceof Rules
  //   //   /**
  //   //    * If previous iteration produced a ruleset, link its
  //   //    * last value to the currently-evaluated rule
  //   //    */
  //   //   if (prevEvald) {
  //   //     if (prevEvald instanceof Rules) {
  //   //       prevEvald._last._next = evald
  //   //     } else {
  //   //       prevEvald._next = evald
  //   //     }
  //   //   }

  //   //   /**
  //   //    * If we're on the first node, and it evals to a ruleset,
  //   //    * link this ruleset's first node to the first node of
  //   //    * the ruleset.
  //   //    */
  //   //   if (this._first === current.node) {
  //   //     if (evaldIsRules) {
  //   //       this._first = (evald as Rules)._first
  //   //     } else {
  //   //       this._first = evald
  //   //     }
  //   //   }

  //   //   if (evaldIsRules && prevEvald) {
  //   //     prevEvald._next = (evald as Rules)._first
  //   //   }

  //   //   /**
  //   //    * If we're on the last node, and it evals to a ruleset,
  //   //    * link this ruleset's last node to the last node of
  //   //    * the ruleset.
  //   //    */
  //   //   if (this._last === current.node) {
  //   //     if (evaldIsRules) {
  //   //       this._last = (evald as Rules)._last
  //   //     } else {
  //   //       this._last = evald
  //   //     }
  //   //   }

  //   //   current = current._next
  //   //   prevEvald = evald
  //   // }

  //   let newRules: Node[] = []

  //   /** @todo - Probably need to re-write bubbling */
  //   let bubbleRootRules = (rule: Node) => {
  //     let importedRoots =
  //       (isNode(rule, 'Ruleset') || isNode(rule, 'AtRule'))
  //         ? rule.value.rules?.rootRules
  //         : rule.rootRules
  //     if (importedRoots) {
  //       const newImportedRoots = new ArrayList()
  //       for (let r of importedRoots) {
  //         if (r.options.hoistToParent) {
  //           r.options.hoistToParent = false
  //           newRules.push(r)
  //           continue
  //         }
  //         newImportedRoots.push(r)
  //       }
  //       let { rootRules } = rules
  //       if (!rootRules) {
  //         rules.rootRules = newImportedRoots
  //       } else {
  //         rootRules.push(...newImportedRoots)
  //       }
  //     }
  //   }
  //   /**
  //    * Bubble rules to root as needed
  //    */
  //   let tryAddToRoot = (rule: Ruleset | AtRule) => {
  //     if (
  //       rules.type !== 'Root'
  //       && (
  //         rule.options.hoistToRoot
  //         || rule.options.hoistToParent
  //         || context.opts.collapseNesting
  //       )
  //     ) {
  //       /** Remove empty rules */
  //       if (!rules.rootRules) {
  //         rules.rootRules = new ArrayList([rule])
  //       } else {
  //         rules.rootRules.push(rule)
  //       }
  //     } else {
  //       newRules.push(rule)
  //     }
  //   }

  //   let walkRules = (rules: Node[]) => {
  //     rules.forEach(rule => {
  //       if (isNode(rule, ['Ruleset', 'AtRule'])) {
  //         tryAddToRoot(rule)
  //         bubbleRootRules(rule)
  //       } else if (rule instanceof Rules) {
  //         bubbleRootRules(rule)
  //         walkRules(rule.value)
  //       } else {
  //         newRules.push(rule)
  //       }
  //     })
  //   }
  //   walkRules(ruleValues)
  //   rules.value = newRules
  //   /** Restore scope */
  //   context.scope = inheritedScope
  //   return rules
  // }

  /**
   * Return an object representation of a ruleset
   *
   * @todo - get primitive values rendered for things
   * like numbers?
   */
  toObject() {
    let output = new Map<string, string>()
    const iterateRules = (rules: Rules) => {
      let value = rules.value
      value.forEach(n => {
        if (n instanceof Declaration) {
          let { name, value, important } = n.value
          output.set(name.toString(), `${n.value.valueOf()}${n.important ? ` ${n.important}` : ''}`)
        } else if (n instanceof Rules) {
          iterateRules(n)
        }
      })
    }
    iterateRules(this as unknown as Rules)
    return Object.fromEntries(output)
  }

  /**
   * SCOPING
   * The scope part of rules. Originally, `Scope` this was a separate
   * class, but making it part of the definition of rules reduces
   * duplication of concepts like "scope parents" since they
   * are just Rules parents.
   */
  /**
   * All indexed collections, keyed. These are the value
   * per scope (like a set of rules).
   *
   * @note - Types are stored differently for disambiguation
   *         See the Prefix enum.
   */
  private _declarationMap: Map<string, Declaration[]> | undefined
  private get declarationMap(): Map<string, Declaration[]> {
    return (this._declarationMap ??= new Map())
  }

  /**
   * Rulesets and mixins. These get indexed multiple times
   * for each simple selector.
   */
  private _selectorMap: Map<string, Array<Mixin | Ruleset>> | undefined
  private get selectorMap(): Map<string, Array<Mixin | Ruleset>> {
    return (this._selectorMap ??= new Map())
  }

  private _rulesSet: RulesEntry[] | undefined
  private get rulesSet(): RulesEntry[] {
    return (this._rulesSet ??= [])
  }

  /**
   * @todo - Figure out the readonly part
   */
  register(node: Node, options?: Record<string, any>) {
    if (isNode(node, 'Rules')) {
      let rulesVisibility = options?.rulesVisibility ?? node.options?.rulesVisibility ?? {}

      /** These are public by default */
      rulesVisibility.Declaration ??= 'public'
      rulesVisibility.Ruleset ??= 'public'

      /** Either one set as readonly will win */
      let readonly = Boolean(options?.readonly || node.options?.readonly)
      this.rulesSet.push({
        node,
        rulesVisibility,
        readonly
      })
    } else if (isNode(node, 'Declaration')) {
      /** `setDefined` is an immediate mutation of the last found instance */
      if (node.options?.setDefined) {
        let key = node.value.name.toString()
        /** Don't set within sibling rules */
        let opts: FindContext = {}
        let result = this.findDeclaration(key, node.type as 'Declaration', opts, true, node.index)
        if (result) {
          if (result.options?.readonly || opts.readonly) {
            throw new ReferenceError(`"${key}" is readonly`)
          }
          /** Over-write value */
          result.value.value = node.value.value.copy()
          /** !important always wins */
          let important = result.value.important || node.value.important
          result.value.important = important
        } else {
          throw new ReferenceError(`"${key}" is not defined`)
        }
      }
      let map = this.declarationMap
      let key = node.value.name.toString()
      let queue = map.get(key) ?? new Queue()
      queue.push(node)
      map.set(key, queue)
    } else {
      /** ? */
    }
  }

  push(node: Node) {
    node.parent = this
    this.value.push(node)
    this.register(node)
  }

  at(index: number) {
    return this.value[index]
  }

  /**
   * Find the closest declaration from start, in reverse order,
   * using a binary search
   */
  private _findClosestByStart(list: Queue<Declaration>, start?: number) {
    if (start === undefined) {
      return list.last
    }
    /**
     * We do this so we start looking above the given position and don't
     * return the current node.
     */
    start -= 1
    let bestMatch: number | undefined

    /** Binary search the queue to find a starting position */
    let left = 0
    let right = list.length - 1

    while (left <= right) {
      let mid = Math.floor((left + right) / 2)
      let midVal = list.at(mid)!.index
      if (midVal === start) {
        bestMatch = mid
        break
      }
      if (midVal < start) {
        bestMatch = mid
        left = mid + 1
      } else {
        right = mid - 1
      }
    }

    return bestMatch !== undefined ? list.at(bestMatch) : undefined
  }

  /**
   * Get declarations from map and nested rulesets.
   * This will return a list of all matching nodes.
   *
   * @todo - The pattern for mixins will be similar, no? Can this be
   * re-used / abstracted?
   */
  findDeclaration(
    key: string,
    type: 'VarDeclaration' | 'Declaration' = 'VarDeclaration',
    opts?: FindContext,
    searchParents: boolean = true,
    start?: number,
    local: boolean = false
  ): Declaration | undefined {
    let declCandidate: [
      declaration: Declaration,
      read?: boolean
    ] | undefined
    let rules: Rules | undefined = this
    let isPublic = false
    while (rules) {
      let currentReadonly = opts?.readonly || rules.options?.readonly
      if (rules._declarationMap) {
        let list = rules.declarationMap.get(key)
        if (list) {
          list = list.filter(
            n =>
              n.type === type
              && (
                !opts?.filter
                || opts.filter(n)
              )
          )
        }
        if (list) {
          let result = rules._findClosestByStart(list, start)
          if (result) {
            declCandidate = [result, result.options?.readonly || currentReadonly]
          }
          isPublic = true
        }
      }

      if (rules._rulesSet) {
        let { rulesSet } = rules
        /**
         * Only consider rules after the last found declaration (if relevant)
         * and before the start position (if relevant)
         */
        rulesSet = rulesSet.filter(n => {
          return (!declCandidate || n.node.index > declCandidate[0].index)
              && (start === undefined || n.node.index < start)
              && (!(local && Boolean(n.node.options?.local)))
              && (
                n.rulesVisibility?.[type] === 'optional'
                || n.rulesVisibility?.[type] === 'public'
              )
        })

        let length = rulesSet.length
        if (length) {
          for (let i = length - 1; i >= 0; i--) {
            let r = rulesSet.at(i)!
            /** Locals can be searched once but not twice */
            let newLocal = local || Boolean(r.node.options?.local)
            let newOpts = opts ? { ...opts, readonly: currentReadonly || r.readonly } : { readonly: currentReadonly || r.readonly }
            let result = r.node.findDeclaration(key, type, newOpts, false, undefined, newLocal)
            if (result) {
              /**
               * If it's public, and it's the lower-most declaration,
               * it wins.
               */
              if (r.rulesVisibility?.[type] === 'public') {
                if (opts && newOpts.readonly) {
                  opts.readonly = true
                }
                return result
              }
              /**
               * The declaration is optional, so we need to keep searching.
               * If we already have a candidate, that means we have a local
               * value which should win.
               */
              if (!declCandidate) {
                declCandidate = [result, newOpts.readonly]
              }
            }
          }
        }
      }
      if (isPublic || !searchParents) {
        if (opts && declCandidate?.[1]) {
          opts.readonly = true
        }
        return declCandidate?.[0]
      }

      do {
        rules = rules?.parent as Rules
      } while (rules && !(rules instanceof Rules))
    }
    if (opts && declCandidate?.[1]) {
      opts.readonly = true
    }
    return declCandidate?.[0]
  }

  /**
   * Returns an executable function
   * @todo - Move from scope
   */
  getMixin(selector: Selector, opts: FindContext = {}) {
    return () => {}
  }

  /**
   * Unlike `eval`, preEval of rules within a Rules instance
   * happens linearly, which helps us assign sequential indexes
   * while traversing nested rules. The indexes will help us
   * when searching "upwards" (Sass-style).
   */
  override async preEval(context: Context): Promise<this> {
    if (!this.preEvaluated) {
      let rules = this.maybeClone(context)
      /**
       * Attach this early? Normally the parent will attach
       * but this causes recursion issues with rules.
       *
       * @todo - Should this be added to node.clone()? I need
       * to think about the implications.
       */
      rules.preEvaluated = true
      if (rules.index === undefined) {
        rules.index = context.ruleCounter++
      }
      for (let [, node] of rules) {
        if (node.index === undefined) {
          node.index = context.ruleCounter++
        }
      }
      return rules
    }
    return this
  }

  override async evalNode(context: Context): Promise<this> {
    let rules = this
    if (!this.preEvaluated) {
      rules = await this.preEval(context)
    }
    let evalQueue: EvalQueueMap = new Map()

    let rulesContext = context.rulesContext
    context.rulesContext = rules
    if (rules.type === 'Root') {
      context.treeContext = rules.treeContext
    }
    // let { leakVariablesIntoScope } = context.treeContext ?? {}
    /**
     * First, push rules onto an evaluation queue.
     */
    for (let item of rules) {
      let [, rule] = item
      let priority = NodeTypeToPriority.get(rule.type) ?? Priority.None
      let queue = evalQueue.get(priority) ?? []
      queue.push(item)
      evalQueue.set(priority, queue)
    }

    /** Now, evaluate the queue in two rounds */
    for (let method of ['preEval', 'eval'] as const) {
      for (let i: Priority = Priority.Highest; i >= 0; i--) {
        let queue = evalQueue.get(i)
        if (!queue) {
          continue
        }
        for (let item of queue) {
          let [i, rule] = item
          if (
            i === Priority.Highest
            && method === 'preEval'
            && isNode(rule, 'Declaration')
            && rule.value.name instanceof Interpolated
          ) {
            let lowQueue = evalQueue.get(Priority.High) ?? new Queue()
            lowQueue.push([i, rule])
            evalQueue.set(Priority.High, lowQueue)
            continue
          }
          /** Only evaluated on reference */
          if (method === 'eval' && isNode(rule, 'VarDeclaration')) {
            continue
          }
          let result!: Node
          result = await rule[method](context)
          if (result !== rule) {
            rules.value[i] = result
            /** Probably already set when evaluating? */
            result.parent = rules
            queue.setAt(i, [i, result])
          }
          if (method === 'preEval') {
            /** Do I need to pass in options? */
            rules.register(result)
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
    /**
     * Restore rules context
     */
    context.rulesContext = rulesContext
    return rules
  }

  /** @todo move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   const value = this.value
  //   out.add('{\n')
  //   context.indent++
  //   let pre = context.pre
  //   value.forEach(v => {
  //     out.add(pre)
  //     v.toCSS(context, out)
  //     out.add('\n')
  //   })
  //   context.indent--
  //   pre = context.pre
  //   out.add(`${pre}}`)
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const depth = context.depth
  //   context.depth = 2

  //   out.add('$J.ruleset(\n', this.location)
  //   context.indent++
  //   let pre = context.pre
  //   out.add(`${pre}(() => {\n`)
  //   context.indent++
  //   out.add(`  ${pre}const $OUT = []\n`)
  //   this.value.forEach((node, i) => {
  //     out.add(`  ${pre}`)
  //     if (node instanceof JsNode) {
  //       node.toModule(context, out)
  //       out.add('\n')
  //     } else if (node instanceof Declaration && context.opts.dynamic) {
  //       /**
  //        * Creates either runtime vars or var() depending on settings
  //        */
  //       const n = node.clone()
  //       const process = (n: Node) => {
  //         if (n instanceof JsExpr || n instanceof Call) {
  //           if (context.isRuntime) {
  //             context.rootRules.push(new Declaration({
  //               name: context.getVar(),
  //               value: n
  //             }))
  //             return n
  //           }
  //           return new Call({
  //             name: 'var',
  //             value: new List([
  //               context.getVar(),
  //               n
  //             ])
  //           })
  //         }
  //         n.processNodes(process)
  //         return n
  //       }
  //       n.processNodes(process)

  //       if (context.isRuntime) {
  //         context.rootRules.forEach(n => {
  //           out.add('$OUT.push(')
  //           n.toModule(context, out)
  //           out.add(')\n')
  //         })
  //         context.rootRules = []
  //       } else {
  //         out.add('$OUT.push(')
  //         n.toModule(context, out)
  //         out.add(')\n')
  //       }
  //     } else {
  //       out.add('$OUT.push(')
  //       node.toModule(context, out)
  //       out.add(')\n')
  //     }
  //   })
  //   out.add(`  ${pre}return $OUT\n${pre}})()`)
  //   context.indent -= 2
  //   pre = context.pre
  //   out.add(`\n${pre})`)

  //   context.depth = depth
  // }
}
export const rules = defineType(Rules, 'Rules')

export type FindContext = {
  filter?: (n: Node) => boolean
  /** This gets set if any parent is set to readonly */
  readonly?: boolean
}

type EvalQueueMap = Map<Priority, Queue<[number, Node]>>

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
  ['Import', Priority.Medium],
  /** Then, resolve any calls */
  ['Call', Priority.Low]
  /** Then, everything else? */
])

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

type IndexKey = `${NodeType}${string}`

interface RulesEntry {
  node: Rules
  rulesVisibility?: RulesOptions['rulesVisibility']
  /**
   * These are from use, from, and import statements. Can't be assigned with $$
   * (verify that this is not possible with SCSS).
   */
  readonly?: RulesOptions['readonly']
}

/**
 * Right now, the only nodes that can be registered to the scope for lookups
 */
type ScopeNodes = Declaration | VarDeclaration | Mixin | Ruleset | Rules