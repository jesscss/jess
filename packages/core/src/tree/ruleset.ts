/* eslint-disable @typescript-eslint/prefer-readonly */
import { Node, defineType, type LocationInfo, type FileInfo } from './node'
import { Declaration } from './declaration'
import type { VarDeclarationOptions } from './var-declaration'
import { Scope } from '../scope'

import type { Context } from '../context'
import { isNode } from './util'
import { type Rule } from './rule'
import { type AtRule } from './at-rule'
import { Nil } from './nil'

export const enum Priority {
  None = 0,
  Low = 1,
  Medium = 2,
  High = 3
}

type QueueItem = {
  node: Node
  /** Position in rules array */
  pos: number
  /** If we're just evaluating a declaration's name */
  nameOnly?: boolean
}

type QueueMap = {
  [Priority.None]?: Set<QueueItem>
  [Priority.Low]?: Set<QueueItem>
  [Priority.Medium]?: Set<QueueItem>
  [Priority.High]?: Set<QueueItem>
}

function assign(map: QueueMap, key: Priority, value: Node, pos: number, nameOnly?: boolean) {
  let set = map[key]
  if (set) {
    set.add({ node: value, pos, nameOnly })
  } else {
    map[key] = new Set([{ node: value, pos, nameOnly }])
  }
}

export type RulesetValues = {
  value: Node[]
  scope?: Scope
}

/**
 * The class representing a "declaration list".
 * CSS calls it this even though CSS Nesting
 * adds a bunch more things that aren't declarations,
 * and Less historically calls this a "Ruleset"
 * (for a set of rules), so we'll keep that name.
 *
 * Used by Rule and Mixin. Additionally, imports / use statements
 * return rulesets.
 *
 * @example
 * color: black;
 * background-color: white;
 */
export class Ruleset extends Node<Node[]> {
  // rootRules: Node[] = []
  // _first: Node
  // _last: Node
  _scope: Scope

  constructor(
    values: RulesetValues | Node[],
    options?: undefined,
    location?: LocationInfo | 0,
    fileInfo?: FileInfo
  ) {
    let { value, scope } = (values as any)
    super([
      ['value', Array.isArray(values) ? values : value]
    ], options, location, fileInfo)
    this._scope = scope ?? new Scope()
  }

  // constructor(value: { scope: }) {
  //   super([])
  // }

  /** Allows array spreading of nodes */
  // * [Symbol.iterator]() {
  //   let current = this._first
  //   while (current) {
  //     yield current
  //     current = current._next
  //   }
  // }

  toTrimmedString(depth: number = 0) {
    let space = ''.padStart(depth * 2)
    let output = space
    let outputs = this.value.map(n => n.toString(depth))
    output += outputs.join(`\n${space}`) + '\n'
    return output
  }

  async eval(context: Context): Promise<Ruleset> {
    return await this.evalIfNot(context, async () => {
      let inheritedScope = context.scope
      context.scope = this._scope
      let { hoistVariables } = context.opts
      let ruleset = this.clone()
      ruleset._scope = this._scope
      /**
       * Make a shallow copy of rules.
       * This is because we're going to replace
       * each item in the array when evaluating.
       */
      let rules = ruleset.value = [...this.value]
      let evalQueue: QueueMap = {}

      /**
       * First, create a linked list.
       * This is so folding in mixins can be done
       * without mutating arrays.
       */
      // let prev: Node | undefined
      let nodeLength = rules.length
      /** Iterate in reverse order, to assign the _next node */
      // for (let i = nodeLength - 1; i >= 0; i--) {
      //   const n = value[i]
      //   if (i === nodeLength - 1) {
      //     this._last = n
      //   }
      //   if (i === 0) {
      //     this._first = n
      //   }
      //   if (prev) {
      //     n._next = prev
      //   }
      //   prev = n
      // }

      /**
       * Assign to the evaluation queue.
       *
       * Evalution order (in Less) should go:
       *   1. static declaration names (names that do not, themselves,
       *      contain variables). This includes mixin and qualified rule names
       *   2. variable declaration names
       *   3. mixin and function calls
       *   3. everything else
       *
       * Everything else:
       *   1. static declaration names of mixins and functions
       *   2. variable declaration names of mixins and functions
       *   3. everything else
       */
      for (let i = 0; i < nodeLength; i++) {
        let n = rules[i]

        if (n instanceof Declaration) {
          if (hoistVariables) {
            if (n.name instanceof Node) {
              /** Evaluate these names after evaluating static names */
              assign(evalQueue, Priority.Medium, n, i, true)
            } else {
              /** Evaluate static names first */
              assign(evalQueue, Priority.High, n, i, true)
            }
          /** Function declarations are also mixins */
          } else if (isNode(n, ['Mixin', 'FunctionDefinition'])) {
            if (n.name instanceof Node) {
              assign(evalQueue, Priority.Medium, n, i, true)
            } else {
              assign(evalQueue, Priority.High, n, i, true)
            }
          } else {
            /**
             * If we're not hoisting variables, evaluate
             * declarations immediately.
             */
            assign(evalQueue, Priority.None, n, i)
          }
        /**
         * Hoist imports
         *
         * @note - this might need tweaking
         */
        } else if (isNode(n, 'Use') || (hoistVariables && isNode(n, 'Call'))) {
          assign(evalQueue, Priority.Low, n, i)
        } else {
          assign(evalQueue, Priority.None, n, i)
        }
      }

      /** Start with high priority */
      for (let i: Priority = Priority.High; i >= 0; i--) {
        let set = evalQueue[i]
        if (!set) {
          continue
        }
        /**
         * @todo Not sure this will work, because they need to
         * evaluate in a guaranteed order
        */
        await this.forEachPromise(set, async ({ node, pos, nameOnly }) => {
          if (nameOnly) {
            let decl = node.clone() as Declaration
            let name = decl.name
            let ident: string
            if (name instanceof Node) {
              ident = (await name.eval(context)).value
              decl.name = ident
            } else {
              ident = name
            }
            rules[pos] = decl
            if (isNode(node, 'Mixin')) {
              this._scope.setMixin(ident, decl, decl.options as VarDeclarationOptions)
            } else if (isNode(node, ['VarDeclaration', 'FunctionDefinition'])) {
              this._scope.setVar(ident, decl, decl.options as VarDeclarationOptions)
            } else {
              this._scope.setProp(ident, decl)
            }
            /**
             * Now that we've evaluated the name, add it to the evaluation queue.
             * (Variable values are not evaluated unless they are called)
             */
            if (isNode(node, 'Declaration')) {
              assign(evalQueue, Priority.None, decl, i)
            }
          } else {
            if (hoistVariables && node instanceof Declaration) {
              /**
               * We've already cloned and partially evaluated this,
               * so we only need to evaluate the value.
               */
              let evald = await node.value.eval(context)
              if (evald instanceof Nil) {
                rules[pos] = evald
              } else {
                node.value = evald
              }
            } else {
              let result: Node
              /** Late evaluation of vars */
              if (isNode(node, 'VarDeclaration')) {
                result = node.clone()
                if (node.name instanceof Node) {
                  node.name = await node.name.eval(context)
                }
              } else {
                result = await node.eval(context)
              }
              rules[pos] = result

              /** Set references linearly */
              if (!hoistVariables && result instanceof Declaration) {
                let ident = result.name instanceof Node ? result.name.value : result.name
                if (isNode(node, 'VarDeclaration')) {
                  this._scope.setVar(ident, result, result.options)
                } else if (isNode(node, 'Declaration')) {
                  this._scope.setProp(ident, result)
                }
              }
              /** Merge any scope that we need for lookups */
              if (result instanceof Ruleset) {
                this._scope.merge(result._scope)
              }
            }
          }
        })

        // let current = map[0]
        // let prevEvald: Node | undefined

        /**
         * This will dynamically link rulesets like
         * [rule]._next = [ruleset]._first
         * [ruleset]._last = [rule]._next._next
         *
         * @todo Register declarations for languages
         *       that merge them in.
         */
        // while (current) {
        //   let evald: Node

        //   if (current.nameOnly) {
        //     const decl = current.node.clone() as Declaration<Node>
        //     decl.name = decl.name.eval(context)
        //     evald = decl
        //   } else {
        //     evald = current.node.eval(context)
        //   }
        //   const evaldIsRuleset = evald instanceof Ruleset
        //   /**
        //    * If previous iteration produced a ruleset, link its
        //    * last value to the currently-evaluated rule
        //    */
        //   if (prevEvald) {
        //     if (prevEvald instanceof Ruleset) {
        //       prevEvald._last._next = evald
        //     } else {
        //       prevEvald._next = evald
        //     }
        //   }

        //   /**
        //    * If we're on the first node, and it evals to a ruleset,
        //    * link this ruleset's first node to the first node of
        //    * the ruleset.
        //    */
        //   if (this._first === current.node) {
        //     if (evaldIsRuleset) {
        //       this._first = (evald as Ruleset)._first
        //     } else {
        //       this._first = evald
        //     }
        //   }

        //   if (evaldIsRuleset && prevEvald) {
        //     prevEvald._next = (evald as Ruleset)._first
        //   }

        //   /**
        //    * If we're on the last node, and it evals to a ruleset,
        //    * link this ruleset's last node to the last node of
        //    * the ruleset.
        //    */
        //   if (this._last === current.node) {
        //     if (evaldIsRuleset) {
        //       this._last = (evald as Ruleset)._last
        //     } else {
        //       this._last = evald
        //     }
        //   }

        //   current = current._next
        //   prevEvald = evald
        // }
      }

      let bubbleRootRules = (rule: Node) => {
        let importedRoots =
          (isNode(rule, 'Rule') || isNode(rule, 'AtRule'))
            ? rule.value?.rootRules
            : rule.rootRules
        if (importedRoots) {
          let { rootRules } = ruleset
          if (!rootRules) {
            ruleset.rootRules = importedRoots
          } else {
            rootRules.push(...importedRoots)
          }
        }
      }
      /**
       * Bubble rules to root as needed
       */
      let tryAddToRoot = (rule: Rule | AtRule) => {
        if (
          ruleset.type !== 'Root' &&
          (rule.options?.hoistToRoot || context.opts.collapseNesting)
        ) {
          if (!ruleset.rootRules) {
            ruleset.rootRules = [rule]
          } else {
            ruleset.rootRules.push(rule)
          }
        } else {
          newRules.push(rule)
        }
      }
      let newRules: Node[] = []

      let walkRules = (rules: Node[]) => {
        rules.forEach(rule => {
          if (isNode(rule, ['Rule', 'AtRule'])) {
            bubbleRootRules(rule)
            tryAddToRoot(rule)
          } else if (rule instanceof Ruleset) {
            bubbleRootRules(rule)
            walkRules(rule.value)
          } else {
            newRules.push(rule)
          }
        })
      }
      walkRules(rules)
      ruleset.value = newRules
      /** Restore scope */
      context.scope = inheritedScope
      return ruleset
    })
  }

  /**
   * Return an object representation of a ruleset
   *
   * @todo - This is unnecessary! When we call
   * a mixin from Jess / Less etc, we will bind
   * `this` to the ruleset of the caller, but
   * when called from JavaScript, `this` will
   * not be an instance of Ruleset, in which
   * case we can auto-serialize it.
   */
  obj() {
    let value = this.value
    let output: Record<string, string> = {}
    value.forEach(n => {
      if (n instanceof Declaration) {
        output[n.name.toString()] = `${n.value}${n.important ? ` ${n.important}` : ''}`
      }
    })
    return output
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
export const ruleset = defineType(Ruleset, 'Ruleset')
Ruleset.prototype.allowRuleRoot = true