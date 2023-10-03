import { Node, defineType } from './node'
import { type Rules } from './rules'
import type { Context } from '../context'
// import type { OutputCollector } from '../output'
import type { SelectorSequence } from './selector-sequence'
import type { SelectorList } from './selector-list'
import { Nil } from './nil'

export type RulesetValue = {
  selector: SelectorList | SelectorSequence | Nil
  /**
   * It's important that any Node that defines a Rules
   * sets it to the `value` property. This allows us to
   * generalize nodes for the `frames` property in Context
   */
  value: Rules
}
/**
 * A qualified rule. This is historically called a "Ruleset"
 * by older CSS documentation and by Less.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Syntax#css_rulesets
 *
 * @example
 * .box {
 *   color: black;
 * }
 */
export class Ruleset extends Node<RulesetValue> {
  get selector() {
    return this.data.get('selector')
  }

  set selector(v: SelectorList | SelectorSequence | Nil) {
    this.data.set('selector', v)
  }

  toTrimmedString(depth: number = 0): string {
    let space = ''.padStart(depth * 2)
    /** The ruleset will have already indented the first line */
    let output = ''
    output += `${this.selector.toString()} {\n`
    output += `${this.value.toString(depth + 1)}`
    output += `${space}}`
    return output
  }

  async eval(context: Context): Promise<Ruleset | Nil> {
    return await this.evalIfNot(context, async () => {
      let rule = this.clone()
      const collapseNesting = context.opts.collapseNesting
      let sels = await this.selector.eval(context)
      let hoistToRoot = this.options?.hoistToRoot ?? context.opts.collapseNesting
      if (hoistToRoot) {
        rule.options = {
          ...this.options ?? {},
          hoistToRoot
        }
      }
      context.opts.collapseNesting = collapseNesting

      if (sels instanceof Nil) {
        return sels
      }
      rule.selector = sels

      context.frames.unshift(rule)
      rule.value = await this.value.eval(context)
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
Ruleset.prototype.allowRuleRoot = true
Ruleset.prototype.allowRoot = true

export const ruleset = defineType<RulesetValue>(Ruleset, 'Ruleset')