import { Node, defineType } from './node'
import { type Rules } from './rules'
import type { Context } from '../context'
import { Nil } from './nil'
import type { Condition } from './condition'
import type { Selector } from './selector'

export type RulesetValue = {
  selector: Selector | Nil
  /**
   * It's important that any Node that defines a Rules
   * sets it to the `rules` property. This allows us to
   * generalize nodes for the `frames` property in Context
   */
  rules: Rules
  guard?: Condition
}

type NarrowRulesetValue<T> = T extends RulesetValue ? T : RulesetValue
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
export class Ruleset<T = RulesetValue> extends Node<NarrowRulesetValue<T>> {
  type = 'Ruleset'
  shortType = 'ruleset'
  override allowRuleRoot = true
  override allowRoot = true

  get selector() {
    return this.data.get('selector')
  }

  /** @todo - remove? */
  override valueOf() {
    return this.selector instanceof Nil ? '' : this.selector.valueOf()
  }

  override toTrimmedString(depth: number = 0): string {
    // let space = ''.padStart(depth * 2)
    let { selector = '', rules } = this.value
    let output = ''
    output += `${selector.toString()}{`
    output += `${rules.toString(depth + 1)}`
    output += '}'
    return output
  }

  override async evalNode(context: Context): Promise<Ruleset | Nil> {
    let rule = this.clone()
    let guard = rule.data.get('guard')
    if (guard) {
      let bool = await guard.eval(context)
      if (!bool.value) {
        return new Nil()
      }
      /** Remove once evaluated */
      rule.data.set('guard', undefined)
    }
    /** Allow a selector to signal that nesting should be collapsed */
    const collapseNesting = context.opts.collapseNesting
    let sels = (await this.selector.eval(context)) as Selector | Nil
    let hoistToParent = this.options?.hoistToParent ?? context.opts.collapseNesting
    if (hoistToParent) {
      rule.options.hoistToParent = true
    }
    context.opts.collapseNesting = collapseNesting

    if (sels instanceof Nil) {
      return sels
    }
    rule.data.set('selector', sels)

    context.frames.push(rule)
    rule.data.set('rules', await this.data.get('rules').eval(context))
    context.frames.pop()

    /** Remove empty rules */
    const rules = rule.data.get('rules')
    if (rules.visibleRules().length === 0) {
      rule.visible = false
    }
    return rule
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

type RulesetParams = ConstructorParameters<typeof Ruleset>

export const ruleset = defineType<RulesetValue>(Ruleset, 'Ruleset') as (
  value: RulesetValue | RulesetParams[0],
  options?: RulesetParams[1],
  location?: RulesetParams[2],
  treeContext?: RulesetParams[3]
) => Ruleset