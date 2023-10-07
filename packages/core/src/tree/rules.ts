/* eslint-disable @typescript-eslint/prefer-readonly */
import { Node, defineType, type LocationInfo, type TreeContext } from './node'
import { Declaration } from './declaration'
import {
  BaseDeclaration,
  type BaseDeclarationValue,
  type Name
} from './base-declaration'
import {
  type VarDeclarationOptions
} from './var-declaration'
import { Scope } from '../scope'
import type { Context } from '../context'
import { isNode } from './util'
import { type Ruleset } from './ruleset'
import { type AtRule } from './at-rule'
import { Nil } from './nil'

export const enum Priority {
  None = 0,
  Low = 1,
  Medium = 2,
  High = 3
}

type AnyDeclarationValue = BaseDeclarationValue & Record<string, any>

type QueueItem = {
  node: Node
  /** Position in rules array */
  pos: number
  nameOnly?: true
} | {
  node: BaseDeclaration<Name, AnyDeclarationValue>
  pos: number
  /** If we're just evaluating a declaration's name */
  nameOnly: true
}

type QueueMap = {
  [Priority.None]?: Set<QueueItem>
  [Priority.Low]?: Set<QueueItem>
  [Priority.Medium]?: Set<QueueItem>
  [Priority.High]?: Set<QueueItem>
}

function assign(map: QueueMap, key: Priority, value: Node, pos: number): void
function assign(map: QueueMap, key: Priority, value: BaseDeclaration<Name, AnyDeclarationValue>, pos: number, nameOnly?: true): void
function assign(map: QueueMap, key: Priority, value: Node, pos: number, nameOnly?: true | undefined) {
  let set = map[key]
  if (set) {
    set.add({ node: value, pos, nameOnly })
  } else {
    map[key] = new Set([{ node: value, pos, nameOnly }])
  }
}

export type RulesValue = {
  value: Node[]
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
 * color: black;
 * background-color: white;
 */
export class Rules extends Node<Node[]> {
  // rootRules: Node[] = []
  // _first: Node
  // _last: Node
  _scope: Scope

  constructor(
    value: Node[],
    options?: undefined,
    location?: LocationInfo | 0,
    treeContext?: TreeContext
  ) {
    super(value, options, location, treeContext)
    let scope = this.treeContext.scope
    Object.defineProperty(this, '_scope', {
      value: new Scope(scope),
      writable: true
    })
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
    let outputs = this.value
      .filter(n => n.visible)
      .map(n => n.toString(depth))
    output += outputs.join(`\n${space}`) + '\n'
    return output
  }

  async eval(context: Context): Promise<this> {
    return await this.evalIfNot(context, async () => {
      let inheritedScope = context.scope
      context.scope = this._scope
      let { hoistDeclarations, leakVariablesIntoScope } = this.treeContext
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
        let n = rules[i]!

        if (n instanceof BaseDeclaration) {
          if (hoistDeclarations) {
            if (n.name instanceof Node) {
              /** Evaluate these names after evaluating static names */
              assign(evalQueue, Priority.Medium, n, i, true)
            } else {
              /** Evaluate static names first */
              assign(evalQueue, Priority.High, n, i, true)
            }
          } else if (isNode(n, ['Mixin', 'Func'])) {
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
        } else if (isNode(n, 'Use') || (hoistDeclarations && isNode(n, 'Call'))) {
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

        for (let item of set) {
          const { node, pos, nameOnly } = item
          if (nameOnly) {
            let decl = node.clone() as BaseDeclaration
            /** Everything in a ruleset root will have a name */
            let name = decl.name!
            let ident: string
            if (name instanceof Node) {
              ident = (await name.eval(context)).value
              decl.name = ident
            } else {
              ident = name
            }
            if (!decl.allowRuleRoot) {
              decl.visible = false
            }
            rules[pos] = decl
            if (isNode(decl, 'Mixin')) {
              this._scope.setMixin(ident, decl, decl.options)
            } else if (isNode(decl, ['VarDeclaration', 'Func'])) {
              this._scope.setVar(ident, decl, decl.options as VarDeclarationOptions)
            } else {
              this._scope.setProp(ident, decl as Declaration)
            }
            /**
             * Now that we've evaluated the name, add it to the evaluation queue.
             * (Variable values are not evaluated unless they are called)
             */
            if (isNode(node, 'Declaration')) {
              assign(evalQueue, Priority.None, decl, i)
            }
          } else {
            if (hoistDeclarations && node instanceof Declaration) {
              /**
               * We've already cloned and partially evaluated this,
               * so we only need to evaluate the value.
               */
              context.declarationScope = node
              let evald = await node.value.eval(context)
              context.declarationScope = undefined
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
                if (node instanceof Declaration) {
                  context.declarationScope = node
                }
                result = await node.eval(context)
              }
              if (!result.allowRuleRoot) {
                result.visible = false
              }
              rules[pos] = result

              /** Set references linearly */
              if (!hoistDeclarations && result instanceof Declaration) {
                let ident = result.name instanceof Node ? result.name.value : result.name
                if (isNode(node, 'VarDeclaration')) {
                  this._scope.setVar(ident, result, result.options)
                } else if (isNode(node, 'Declaration')) {
                  this._scope.setProp(ident, result)
                }
              }
              /** Merge any scope that we need for lookups */
              if (result instanceof Rules) {
                this._scope.merge(result._scope, leakVariablesIntoScope)
              }
            }
          }
        }

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
        //   const evaldIsRules = evald instanceof Rules
        //   /**
        //    * If previous iteration produced a ruleset, link its
        //    * last value to the currently-evaluated rule
        //    */
        //   if (prevEvald) {
        //     if (prevEvald instanceof Rules) {
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
        //     if (evaldIsRules) {
        //       this._first = (evald as Rules)._first
        //     } else {
        //       this._first = evald
        //     }
        //   }

        //   if (evaldIsRules && prevEvald) {
        //     prevEvald._next = (evald as Rules)._first
        //   }

        //   /**
        //    * If we're on the last node, and it evals to a ruleset,
        //    * link this ruleset's last node to the last node of
        //    * the ruleset.
        //    */
        //   if (this._last === current.node) {
        //     if (evaldIsRules) {
        //       this._last = (evald as Rules)._last
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
          (isNode(rule, 'Ruleset') || isNode(rule, 'AtRule'))
            ? rule.rules?.rootRules
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
      let tryAddToRoot = (rule: Ruleset | AtRule) => {
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
          } else if (rule instanceof Rules) {
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
   * @todo - get primitive values rendered for things
   * like numbers?
   */
  toObject() {
    let output = new Map<string, string>()
    const iterateRules = (rules: Rules) => {
      let value = rules.value
      value.forEach(n => {
        if (n instanceof Declaration) {
          output.set(n.name.toString(), `${n.value.valueOf()}${n.important ? ` ${n.important}` : ''}`)
        } else if (n instanceof Rules) {
          iterateRules(n)
        }
      })
    }
    iterateRules(this as unknown as Rules)
    return Object.fromEntries(output)
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
Rules.prototype.allowRuleRoot = true