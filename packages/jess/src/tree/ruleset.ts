import { Node, NodeMap, ILocationInfo, JsNode, Nil } from '.'
import type { Context } from '../context'
import { OutputCollector } from '../output'
import { Rule } from './rule'

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

  eval(context: Context) {
    if (!this.evaluated) {
      const rule = this.clone()

      const rules: Node[] = []
      this.value.forEach(rule => {
        rule = rule.eval(context)
        if (rule && !(rule instanceof Nil)) {
          /** @todo - at-rules */
          if (rule instanceof Rule) {
            context.rootRules.push(rule)
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
    out.add(`${pre}}\n`)
  }

  toModule(context: Context, out: OutputCollector) {
    const rootLevel = context.rootLevel
    context.rootLevel = 2

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

    context.rootLevel = rootLevel
  }
}

export const ruleset =
  (value: Node[] | NodeMap, location?: ILocationInfo) =>
    new Ruleset(value, location)