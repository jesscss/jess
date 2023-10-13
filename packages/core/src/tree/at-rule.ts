import { Node, defineType } from './node'
import { SelectorSequence } from './selector-sequence'
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
  get prelude() {
    return this.data.get('prelude')
  }

  set prelude(v: Node | undefined) {
    this.data.set('prelude', v)
  }

  get name() {
    return this.data.get('name')
  }

  set name(v: General) {
    this.data.set('name', v)
  }

  get rules() {
    return this.data.get('rules')
  }

  set rules(v: Rules | undefined) {
    this.data.set('rules', v)
  }

  toTrimmedString(depth: number = 0): string {
    let { name, prelude, rules } = this
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

  async eval(context: Context) {
    let node = await super.eval(context) as AtRule
    /** Don't let rooted rules bubble past an at-rule */
    if (node.rules) {
      let rules = node.rules
      /**
       * Wrap sub-rules of a media query like Less
       *
       * @todo - do not do this if we're outputting nesting
       * this probably has to be re-written
       */
      if (context.frames.length !== 0) {
        let rule = await new Ruleset([
          ['selector', new SelectorSequence([new Ampersand()])],
          ['rules', rules]
        ])
          .inherit(this)
          .eval(context)
        node.rules.value = [rule]
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
AtRule.prototype.allowRoot = true

export const atrule = defineType(AtRule, 'AtRule')