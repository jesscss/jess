import { Node, Ruleset } from '.'
import type { ILocationInfo } from './node'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

export type AtRuleValue = {
  name: string
  /** The prelude */
  value: Node
  rules?: Ruleset
}

/**
 * A rule like @charset or @media
 */
export class AtRule extends Node {
  name: string
  value: Node
  rules: Ruleset

  toCSS(context: Context, out: OutputCollector) {
    out.add(`${this.name} `, this.location)
    this.value.toCSS(context, out)
    if (this.rules) {
      this.rules.toCSS(context, out)
    } else {
      out.add(';')
    }
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(`$J.atrule({\n`, this.location)
    let pre = context.pre
    context.indent++
    out.add(`${pre}  name: ${JSON.stringify(this.name)},\n`)
    out.add(`${pre}  value: ${this.value.toModule(context, out)}`)
    const rules = this.rules
    if (rules) {
      out.add(`,\n${pre}  rules: ${rules.toModule(context, out)}`)
    }
    context.indent--
    out.add(`,\n${pre}})\n`)
  }
}

export const atrule =
  (value: AtRuleValue, location?: ILocationInfo) =>
    new AtRule(value, location)