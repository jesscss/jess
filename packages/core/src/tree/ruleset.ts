/* eslint-disable @typescript-eslint/prefer-readonly */
import { Node, defineType } from './node'
import { Declaration } from './declaration'
import { Call } from './call'

import type { Context } from '../context'

/**
 * The class representing a "declaration list".
 * CSS calls it this even though CSS Nesting
 * adds a bunch more things that aren't declarations,
 * and Less historically calls this a "Ruleset"
 * (for a set of rules), so we'll keep that name.
 *
 * Used by Rule and Mixin
 *
 * @example
 * color: black;
 * background-color: white;
 *
 * @todo Nodes should be stored in a binary search tree?
 *       Ideally, we would not have to iterate through all nodes to
 *       find declaration / variable / function names.
 *
 *       Therefore, every entry of a node should be stored in this
 *       tree, including qualified rules (used by extend). Extend,
 *       however, would not search the tree, but would make an entry
 *       that is used by qualified rules when rendering.
 *
 * @see https://stackoverflow.com/questions/2130416/what-are-the-applications-of-binary-trees
 */

export const enum Priority {
  Low = 0,
  Medium = 1,
  High = 2
}

type QueueMap = {
  [Priority.Low]?: Node[]
  [Priority.Medium]?: Node[]
  [Priority.High]?: Node[]
}

const assign = (map: QueueMap, key: Priority, value: Node) => {
  const arr = map[key]
  if (arr) {
    map[key]?.push(value)
  } else {
    map[key] = [value]
  }
}

export class Ruleset extends Node<Node[]> {
  // rootRules: Node[] = []
  private _first: Node
  private _last: Node
  private _evalQueue: QueueMap = {};

  constructor(value: { scope: }) {
    super([])
  }

  /** Allows array spreading of nodes */
  * [Symbol.iterator]() {
    let current = this._first
    while (current) {
      yield current
      current = current._next
    }
  }

  eval(context: Context) {
    if (!this.evaluated) {
      const rules = this.clone()
      const { value, _evalQueue } = this

      /**
       * First, create a linked list.
       * This is so folding in mixins can be done
       * without mutating arrays.
       */
      let prev: Node | undefined
      const nodeLength = value.length
      /** Iterate in reverse order, to assign the _next node */
      for (let i = nodeLength - 1; i >= 0; i--) {
        const n = value[i]
        if (i === nodeLength - 1) {
          this._last = n
        }
        if (i === 0) {
          this._first = n
        }
        if (prev) {
          n._next = prev
        }
        prev = n
      }

      if (context.opts.hoist) {
        /**
         * Assign to the evaluation queue.
         *
         * Evalution order (for Less) should go:
         *   1. declaration names
         *   2. mixin and function calls
         *   3. everything else
         *
         * Modes other than Less will use a linear evaluation order
         */
        for (let i = 0; i < nodeLength; i++) {
          const n = value[i]
          if (n instanceof Declaration && n.name instanceof Node) {
            assign(_evalQueue, Priority.High, n.name)
          } else if (n instanceof Call) {
            assign(_evalQueue, Priority.Medium, n)
          } else {
            assign(_evalQueue, Priority.Low, n)
          }
        }
      } else {
        _evalQueue[0] = value
      }

      /** Start with high priority */
      for (let i: Priority = Priority.High; i >= 0; i--) {
        const map = _evalQueue[i]
        if (!map) {
          continue
        }
        let current = map[0]
        let prevEvald: Node | undefined

        /**
         * This will dynamically link rulesets like
         * [rule]._next = [ruleset]._first
         * [ruleset]._last = [rule]._next._next
         *
         * @todo Register declarations
         */
        while (current) {
          const evald = current.eval(context)
          const evaldIsRuleset = evald instanceof Ruleset
          /**
           * If previous iteration produced a ruleset, link its
           * last value to the currently-evaluated rule
           */
          if (prevEvald) {
            if (prevEvald instanceof Ruleset) {
              prevEvald._last._next = evald
            } else {
              prevEvald._next = evald
            }
          }

          /**
           * If we're on the first node, and it evals to a ruleset,
           * link this ruleset's first node to the first node of
           * the ruleset.
           */
          if (this._first === current) {
            if (evaldIsRuleset) {
              this._first = evald._first
            } else {
              this._first = evald
            }
          }

          if (evaldIsRuleset && prevEvald) {
            prevEvald._next = evald._first
          }

          /**
           * If we're on the last node, and it evals to a ruleset,
           * link this ruleset's last node to the last node of
           * the ruleset.
           */
          if (this._last === current) {
            if (evaldIsRuleset) {
              this._last = evald._last
            } else {
              this._last = evald
            }
          }

          current = current._next
          prevEvald = evald
        }
      }

      /**
       * @todo - previous code dumps at-rules and qualified rules
       *         into the rootRules array. This would not handle
       *         CSS Nesting, so we need to re-think this
       */
      // if (result && !(result instanceof Nil)) {
      //   if (result.type === 'Rule' || result.type === 'AtRule') {
      //     this.rootRules.push(rule, ...rule.collectRoots())
      //   } else if (result instanceof Ruleset) {
      //     /** Collapse a ruleset into rules */
      //     result.value.forEach(r => {
      //       if (r.type === 'Rule' || r.type === 'AtRule') {
      //         this.rootRules.push(r)
      //       } else {
      //         rules.push(r)
      //       }
      //     })
      //   } else {
      //     rules.push(result)
      //   }
      // }

      return this.finishEval(rules)
    }
    return this
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
    const value = this.value
    const output: Record<string, string> = {}
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
export const ruleset = defineType<Node[]>(Ruleset, 'Ruleset')
Ruleset.prototype.allowRuleRoot = true