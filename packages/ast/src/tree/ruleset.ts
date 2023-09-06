import type { NodeMap, LocationInfo } from './node'
import { Node, defineType } from './node'
import { JsNode } from './js-node'
import { Nil } from './nil'
import { Declaration } from './declaration'
import { JsExpr } from './js-expr'
import { Call } from './call'
import { List } from './list'

import type { Context } from '../context'
import type { OutputCollector } from '../output'

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
 */
export class Ruleset extends Node<Node[]> {
  rootRules: Node[] = []

  eval(context: Context) {
    if (!this.evaluated) {
      const rule = this.clone()

      const rules: Node[] = []
      this.value.forEach(rule => {
        const result = rule.eval(context)
        if (result && !(result instanceof Nil)) {
          if (result.type === 'Rule' || result.type === 'AtRule') {
            this.rootRules.push(rule, ...rule.collectRoots())
          } else if (result instanceof Ruleset) {
            /** Collapse a ruleset into rules */
            result.value.forEach(r => {
              if (r.type === 'Rule' || r.type === 'AtRule') {
                this.rootRules.push(r)
              } else {
                rules.push(r)
              }
            })
          } else {
            rules.push(result)
          }
        }
      })

      rule.value = rules
      rule.evaluated = true

      return rule
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