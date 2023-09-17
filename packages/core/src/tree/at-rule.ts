import { Node, defineType } from './node'
import { List } from './list'
import { Ampersand } from './ampersand'
import { Rule } from './rule'
import type { Ruleset } from './ruleset'
import type { Context } from '../context'

export type AtRuleValue = {
  name: string
  /** The prelude */
  prelude: Node
  value?: Ruleset
}

/**
 * A rule like @charset or @media
 */
export class AtRule extends Node<AtRuleValue> {
  /** @todo - Volar keeps getting confused, so this has assertions */
  get prelude() {
    return this.data.get!('prelude')
  }

  set prelude(v: Node) {
    this.data.set!('prelude', v)
  }

  get name() {
    return this.data.get!('name')
  }

  set name(v: string) {
    this.data.set!('name', v)
  }

  async eval(context: Context) {
    let node = await super.eval(context) as AtRule
    /** Don't let rooted rules bubble past an at-rule */
    if (node.value) {
      let rules = node.value.value
      /**
       * Wrap sub-rules of a media query like Less
       *
       * @todo - do not do this if we're outputting nesting
       */
      if (context.frames.length !== 0) {
        let rule = await new Rule([
          ['selector', new List([new Ampersand()])],
          ['value', rules]
        ])
          .inherit(this)
          .eval(context)
        rules = [rule]
        node.value.value = rules
      }
      let rootRules = this.collectRoots()
      rootRules.forEach(rule => rules.push(rule))
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