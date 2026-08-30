import { Node, NodeMap, LocationInfo } from './node'
import { Ruleset } from './ruleset'
import { Nil } from './nil'
import type { Context } from '../context'
import { OutputCollector } from '../output'

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

      /** Remove empty rules */
      if (rule.value.value.length === 0) {
        return new Nil()
      }
      return rule
    }
    return this
  }

  toCSS(context: Context, out: OutputCollector) {
    const { sels, value } = this
    context.inSelector = true
    sels.toCSS(context, out)
    context.inSelector = false
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
    out.add(`},${JSON.stringify(this.location)})`)
  }
}
Rule.prototype.allowRoot = true
Rule.prototype.type = 'Rule'

export const rule =
  (value: RuleValue, location?: LocationInfo) =>
    new Rule(value, location)