import { Node, NodeMap, LocationInfo } from './node'
import { JsNode } from './js-node'
import { Nil } from './nil'
import { Declaration } from './declaration'
import { JsExpr } from './js-expr'
import { Call } from './call'
import { List } from './list'

import { Context } from '../context'
import type { OutputCollector } from '../output'

/**
 * A set of nodes (usually declarations)
 * Used by Rule and Mixin
 * 
 * @example
 * color: black;
 * background-color: white;
 */
export class Ruleset extends Node {
  value: Node[]
  rootRules: Node[] = []

  eval(context: Context) {
    if (!this.evaluated) {
      const rule = this.clone()

      const rules: Node[] = []
      this.value.forEach(rule => {
        rule = rule.eval(context)
        if (rule && !(rule instanceof Nil)) {
          if (rule.type === 'Rule' || rule.type === 'AtRule') {
            this.rootRules.push(rule, ...rule.collectRoots())
          } else if (rule instanceof Ruleset) {
            /** Collapse a ruleset into rules */
            rule.value.forEach(r => {
              if (r.type === 'Rule' || r.type === 'AtRule') {
                this.rootRules.push(r)
              }
              else {
                rules.push(r)
              }
            })
          } else {
            rules.push(rule)
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
   */
  obj() {
    const value = this.value
    const output: { [k: string]: string } = {}
    value.forEach(n => {
      if (n instanceof Declaration) {
        output[n.name.toString()] = `${n.value}${n.important ? ` ${n.important}` : ''}`
      }
    })
    return output
  }

  toCSS(context: Context, out: OutputCollector) {
    const value = this.value
    out.add('{\n')
    context.indent++
    let pre = context.pre
    value.forEach(v => {
      out.add(pre)
      v.toCSS(context, out)
      out.add('\n')
    })
    context.indent--
    pre = context.pre
    out.add(`${pre}}`)
  }

  toModule(context: Context, out: OutputCollector) {
    const depth = context.depth
    context.depth = 2

    out.add(`$J.ruleset(\n`, this.location)
    context.indent++
    let pre = context.pre
    out.add(`${pre}(() => {\n`)
    context.indent++
    out.add(`  ${pre}const $OUT = []\n`)
    this.value.forEach((node, i) => { 
      out.add(`  ${pre}`)
      if (node instanceof JsNode) {
        node.toModule(context, out)
        out.add('\n')
      } else if (node instanceof Declaration && context.opts.dynamic) {
        /**
         * Creates either runtime vars or var() depending on settings
         */
        const n = node.clone()
        const process = (n: Node) => {
          if (n instanceof JsExpr || n instanceof Call) {
            if (context.isRuntime) {
              context.rootRules.push(new Declaration({
                name: context.getVar(),
                value: n
              }))
              return n
            }
            return new Call({
              name: 'var',
              value: new List([
                context.getVar(),
                n
              ])
            })
          }
          n.processNodes(process)
          return n
        }
        n.processNodes(process)

        if (context.isRuntime) {
          context.rootRules.forEach(n => {
            out.add(`$OUT.push(`)
            n.toModule(context, out)
            out.add(`)\n`)
          })
          context.rootRules = []
        } else {
          out.add(`$OUT.push(`)
          n.toModule(context, out)
          out.add(`)\n`)
        }
      } else {
        out.add(`$OUT.push(`)
        node.toModule(context, out)
        out.add(`)\n`)
      }
    })
    out.add(`  ${pre}return $OUT\n${pre}})()`)
    context.indent -= 2
    pre = context.pre
    out.add(`\n${pre})`)

    context.depth = depth
  }
}
Ruleset.prototype.allowRuleRoot = true
Ruleset.prototype.type = 'Ruleset'

export const ruleset =
  (value: Node[] | NodeMap, location?: LocationInfo) =>
    new Ruleset(value, location)