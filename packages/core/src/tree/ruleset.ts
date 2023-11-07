import { Node, defineType } from './node'
import { type Rules } from './rules'
import type { Context } from '../context'
// import type { OutputCollector } from '../output'
import type { SelectorSequence } from './selector-sequence'
import type { SelectorList } from './selector-list'
import type { Extend } from './extend'
import { Nil } from './nil'
import type { Condition } from './condition'
export type RulesetValue = {
  selector: SelectorList | SelectorSequence | Extend | Nil
  /**
   * It's important that any Node that defines a Rules
   * sets it to the `rules` property. This allows us to
   * generalize nodes for the `frames` property in Context
   */
  rules: Rules
  guard?: Condition
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

  set selector(v: SelectorList | SelectorSequence | Extend | Nil) {
    this.data.set('selector', v)
  }

  get rules() {
    return this.data.get('rules')
  }

  set rules(v: Rules) {
    this.data.set('rules', v)
  }

  get guard() {
    return this.data.get('guard')
  }

  set guard(v: Condition | undefined) {
    this.data.set('guard', v)
  }

  toTrimmedString(depth: number = 0): string {
    // let space = ''.padStart(depth * 2)
    let output = ''
    output += `${this.selector.toString()}{`
    output += `${this.rules.toString(depth + 1)}`
    output += '}'
    return output
  }

  async eval(context: Context): Promise<Ruleset | Nil> {
    return await this.evalIfNot(context, async () => {
      let rule = this.clone()
      if (rule.guard) {
        let guard = await rule.guard.eval(context)
        if (!guard.value) {
          return new Nil().inherit(this)
        }
        /** Remove once evaluated */
        rule.guard = undefined
      }
      /** Allow a selector to signal that nesting should be collapsed */
      const collapseNesting = context.opts.collapseNesting
      let sels = await this.selector.eval(context)
      let hoistToParent = this.options?.hoistToParent ?? context.opts.collapseNesting
      if (hoistToParent) {
        rule.options.hoistToParent = true
      }
      context.opts.collapseNesting = collapseNesting

      if (sels instanceof Nil) {
        return sels
      }
      rule.selector = sels

      context.frames.unshift(rule)
      rule.rules = await this.rules.eval(context)
      context.frames.shift()

      /** Remove empty rules */
      if (rule.rules.value.length === 0) {
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

type RulesetParams = ConstructorParameters<typeof Ruleset>

export const ruleset = defineType<RulesetValue>(Ruleset, 'Ruleset') as (
  value: RulesetValue | RulesetParams[0],
  options?: RulesetParams[1],
  location?: RulesetParams[2],
  treeContext?: RulesetParams[3]
) => Ruleset