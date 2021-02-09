import { Node, LocationInfo } from './node'
import { List } from './list'
import { Ampersand } from './ampersand'
import { Rule } from './rule'
import type { Ruleset } from './ruleset'
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

  eval(context: Context) {
    const node = <AtRule> super.eval(context)
    /** Don't let rooted rules bubble past an at-rule */
    if (node.rules) {
      let rules = node.rules.value
      /** Wrap sub-rules of a media query like Less */
      if (context.frames.length !== 0) {
        const rule = new Rule({ sels: new List([new Ampersand()]), value: rules })
          .inherit(this)
          .eval(context)
        rules = [rule]
        node.rules.value = rules
      }
      const rootRules = this.collectRoots()
      rootRules.forEach(rule => rules.push(rule))
    }
    return node
  }

  toCSS(context: Context, out: OutputCollector) {
    out.add(`${this.name}`, this.location)
    /** Prelude expression includes white space */
    const value = this.value
    if (value) {
      value.toCSS(context, out)
    }
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
    out.add(`${pre}  name: ${JSON.stringify(this.name)}`)
    const value = this.value
    if (value) {
      out.add(`,\n${pre}  value: `)
      value.toModule(context, out)
    }
    const rules = this.rules
    if (rules) {
      out.add(`,\n${pre}  rules: `)
      rules.toModule(context, out)
    }
    context.indent--
    out.add(`\n${pre}},${JSON.stringify(this.location)})`)
  }
}
AtRule.prototype.allowRoot = true
AtRule.prototype.type = 'AtRule'

export const atrule =
  (value: AtRuleValue, location?: LocationInfo) =>
    new AtRule(value, location)