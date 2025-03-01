import { Node, defineType, type NodeData } from './node'
import { ComplexSelector } from './selector-complex'
import { Ampersand } from './ampersand'
import { Ruleset } from './ruleset'
import type { General } from './general'
import type { Rules } from './rules'
import type { Context } from '../context'

export type AtRuleValue = {
  name: General<'Name'>
  /** The prelude */
  prelude?: Node
  rules?: Rules
}

/**
 * A rule like @charset or @media
 */
export class AtRule extends Node<AtRuleValue> {
  declare value: AtRuleValue
  type = 'AtRule' as const
  shortType = 'atrule' as const
  override allowRoot = true

  override toTrimmedString(depth: number = 0): string {
    let { name, prelude, rules } = this.value
    /** The ruleset will have already indented the first line */
    let output = `${name}`
    if (prelude) {
      output += prelude.toString()
    }
    if (rules) {
      output += `{${rules.toString(depth + 1)}}`
    } else {
      output += ';'
    }
    return output
  }

  override async evalNode(context: Context) {
    let node = await super.evalNode(context) as AtRule
    let rules = node.value.rules
    /** Don't let rooted rules bubble past an at-rule */
    if (rules) {
      /**
       * Wrap sub-rules of a media query like Less
       */
      if (context.opts.collapseNesting && context.frames.size !== 0) {
        let rule = await new Ruleset({
          selector: new ComplexSelector([new Ampersand()]),
          rules: rules
        })
          .inherit(this)
          .eval(context)
        node.data.set('rules', [rule])
      }
      let rootRules = this.collectRoots()
      rootRules.forEach(rule => rules.value.push(rule))
    }
    return node
  }

  /** @todo - move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   out.add(`${this.name}`, this.location)
  //   /** Prelude expression includes white space */
  //   const value = this.value
  //   if (value) {
  //     value.toCSS(context, out)
  //   }
  //   if (this.rules) {
  //     this.rules.toCSS(context, out)
  //   } else {
  //     out.add(';')
  //   }
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.atrule({\n', this.location)
  //   const pre = context.pre
  //   context.indent++
  //   out.add(`${pre}  name: ${JSON.stringify(this.name)}`)
  //   const value = this.value
  //   if (value) {
  //     out.add(`,\n${pre}  value: `)
  //     value.toModule(context, out)
  //   }
  //   const rules = this.rules
  //   if (rules) {
  //     out.add(`,\n${pre}  rules: `)
  //     rules.toModule(context, out)
  //   }
  //   context.indent--
  //   out.add(`\n${pre}},${JSON.stringify(this.location)})`)
  // }
}

export const atrule = defineType(AtRule, 'AtRule')