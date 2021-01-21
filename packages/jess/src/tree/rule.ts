import { Node, NodeMap, LocationInfo, Ruleset } from '.'
import type { Context } from '../context'
import { OutputCollector } from '../output'
import { List } from './list'

type RuleValue = NodeMap & {
  sels: Node
  value: Ruleset | Node[]
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
  value: Ruleset

  constructor(
    value: RuleValue,
    location?: LocationInfo
  ) {
    const val = value.value
    if (Array.isArray(val)) {
      value.value = new Ruleset(val)
    }
    super(value, location)
  }

  eval(context: Context) {
    if (!this.evaluated) {
      const rule = this.clone()
      const sels = this.sels.eval(context)
      rule.sels = sels
      
      context.frames.unshift(sels)
      rule.value = this.value.eval(context)
      context.frames.shift()

      rule.evaluated = true
      return rule
    }
    return this
  }

  toCSS(context: Context, out: OutputCollector) {
    const { sels, value } = this
    /** A selector list gets output to multiple lines */
    if (sels instanceof List) {
      const length = sels.value.length - 1
      const pre = context.pre
      sels.value.forEach((sel, i) => {
        (<Node>sel).toCSS(context, out)
        if (i < length) {
          out.add(`,\n${pre}`)
        }
      })
    } else {
      sels.toCSS(context, out)
    }
    out.add(' ')
    value.toCSS(context, out)
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(`$J.rule({\n`, this.location)
    context.indent++
    let pre = context.pre
    out.add(`${pre}sels: `)
    this.sels.toModule(context, out)
    out.add(`,\n${pre}value: `)
    this.value.toModule(context, out)
    context.indent--
    pre = context.pre
    out.add(`${pre}},${JSON.stringify(this.location)})`)
  }
}

export const rule =
  (value: RuleValue, location?: LocationInfo) =>
    new Rule(value, location)