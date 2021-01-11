import { Node, NodeMap, ILocationInfo, JsNode, Nil } from '.'
import type { Context } from '../context'
import { OutputCollector } from '../output'

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

      rule.value = this.value
        .map(rule => rule.eval(context))
        .filter(n => n && !(n instanceof Nil))

      rule.evaluated = true
      return rule
    }
    return this
  }

  toCSS(context: Context, out: OutputCollector) {
    const value = this.value
    out.add('{\n')
    context.indent++
    const pre = context.pre
    value.forEach(v => {
      out.add(pre)
      v.toCSS(context, out)
      out.add('\n')
    })
    context.indent--
    out.add('}\n')
  }

  toModule(context: Context, out: OutputCollector) {
    let isRoot = context.isRoot
    context.isRoot = false

    out.add(`_J.ruleset(\n`, this.location)
    context.indent++
    let pre = context.pre
    out.add(`${pre}(() => {\n`)
    context.indent++
    out.add(`  ${pre}const __OUT = []\n`)
    this.value.forEach((node, i) => { 
      out.add(`  ${pre}`)
      if (node instanceof JsNode) {
        node.toModule(context, out)
        out.add('\n')
      } else {
        out.add(`__OUT.push(`)
        node.toModule(context, out)
        out.add(`)\n`)
      }
    })
    out.add(`  ${pre}return __OUT\n${pre})()`)
    context.indent -= 2
    pre = context.pre
    out.add(`\n${pre})`)

    context.isRoot = isRoot
  }
}

export const ruleset =
  (value: Node[] | NodeMap, location?: ILocationInfo) =>
    new Ruleset(value, location)