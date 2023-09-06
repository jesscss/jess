import type { LocationInfo } from './node'
import { Node } from './node'
import { type Ruleset } from './ruleset'
import type { Context } from '../context'
// import type { OutputCollector } from '../output'
import type { Selector } from './selector'

type RuleValue = {
  /** This will be either a List<Selector> or Selector */
  selector: Selector | null
  value: Ruleset
}
/**
 * A qualified rule
 * @example
 * .box {
 *   color: black;
 * }
 */
export class Rule extends Node<RuleValue> {
  get selector() {
    return this.data.get('selector')
  }

  set selector(v: Selector | null) {
    this.data.set('selector', v)
  }

  eval(context: Context) {
    if (!this.evaluated) {
      const rule = this.clone()
      const sels = this.selector?.eval(context)
      if (!sels) {
        return null
      }
      rule.selector = sels

      context.frames.unshift(sels)
      rule.value = this.value.eval(context)
      context.frames.shift()

      rule.evaluated = true

      /** Remove empty rules */
      if (rule.value.value.length === 0) {
        return null
      }
      return rule
    }
    return this
  }

  /** @todo move to ToCssVisitor */
  // toCSS(context: Context, out: OutputCollector) {
  //   const { sels, value } = this
  //   context.inSelector = true
  //   sels.toCSS(context, out)
  //   context.inSelector = false
  //   out.add(' ')
  //   value.toCSS(context, out)
  // }

  /** @todo Move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.rule({\n', this.location)
  //   context.indent++
  //   const pre = context.pre
  //   out.add(`${pre}sels: `)
  //   this.sels.toModule(context, out)
  //   out.add(`,\n${pre}value: `)
  //   this.value.toModule(context, out)
  //   context.indent--
  //   out.add(`},${JSON.stringify(this.location)})`)
  // }
}
Rule.prototype.allowRoot = true
Rule.prototype.type = 'Rule'

export const rule =
  (value: RuleValue, location?: LocationInfo) =>
    new Rule(value, location)