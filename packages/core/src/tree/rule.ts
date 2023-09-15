import { Node, defineType } from './node'
import { type Ruleset } from './ruleset'
import type { Context } from '../context'
// import type { OutputCollector } from '../output'
import type { Selector } from './selector'
import type { List } from './list'
import { Nil } from './nil'

export type RuleValue = {
  selector: Selector | List<Selector> | Nil
  /**
   * It's important that any Node that defines a Ruleset
   * sets it to the `value` property. This allows us to
   * generalize nodes for the `frames` property in Context
   */
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

  set selector(v: Selector | List<Selector> | Nil) {
    this.data.set('selector', v)
  }

  async eval(context: Context): Rule | Nil {
    return await this.evalIfNot(context, () => {
      const rule = this.clone()
      const sels = this.selector.eval(context)
      if (sels instanceof Nil) {
        return sels
      }
      rule.selector = sels

      context.frames.unshift(rule)
      rule.value = this.value.eval(context)
      context.frames.shift()

      /** Remove empty rules */
      if (rule.value.value.length === 0) {
        return new Nil().inherit(this)
      }
      return rule
    })
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

export const rule = defineType<RuleValue>(Rule, 'Rule')