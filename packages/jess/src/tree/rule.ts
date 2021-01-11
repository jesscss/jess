import { Node, NodeMap, ILocationInfo, Let, Nil } from '.'
import type { Context } from '../context'
import { OutputCollector } from '../output'
import { sel } from './selector'

type RuleValue = NodeMap & {
  sels: Node
  value: Node[]
}
/**
 * A qualified rule
 * @example
 * .box {
 *   color: black;
 * }
 */
export class Rule extends Node {
  sels: Node
  value: Node[]

  eval(context: Context) {
    if (!this.evaluated) {
      const rule = this.clone()
      rule.sels = this.sels.eval(context)
      
      context.frames.unshift(rule)
      rule.value = this.value
        .map(rule => rule.eval(context))
        .filter(n => n && !(n instanceof Nil))
      context.frames.shift()

      rule.evaluated = true
      return rule
    }
    return this
  }

  toCSS(context: Context, out: OutputCollector) {
    const { sels, value } = this
    sels.toCSS(context, out)
    out.add(' {\n')
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

    out.add(`J.rule({\n`, this.location)
    context.indent++
    let pre = context.pre
    out.add(`${pre}sels: `)
    this.sels.toModule(context, out)
    out.add(`,\n${pre}value: (() => {\n`)
    context.indent++
    out.add(`  ${pre}const __OUT = []\n`)
    this.value.forEach((node, i) => { 
      out.add(`  ${pre}`)
      if (node instanceof Let) {
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
    out.add(`\n${pre}})`)

    context.isRoot = isRoot
  }
}

export const rule =
  (value: RuleValue, location?: ILocationInfo) =>
    new Rule(value, location)