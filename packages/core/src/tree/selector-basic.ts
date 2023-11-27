import type { Context } from '../context'
import { defineType } from './node'
import { SimpleSelector } from './selector-simple'

/**
 * A basic selector
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_selectors/Selectors_and_combinators#basic_selectors
 *   e.g. div, .foo, #bar
*/
export class BasicSelector extends SimpleSelector<string> {
  get isClass() {
    return /^\./.test(this.value)
  }

  get isId() {
    return /^#/.test(this.value)
  }

  /** A tag-type selector */
  get isTag() {
    return /^[^.#*]/.test(this.value)
  }

  toPrimitiveSelector() {
    return this.value
  }

  async eval(context: Context): Promise<BasicSelector> {
    return await this.evalIfNot(context, async () => {
      let node = await super.eval(context) as BasicSelector
      if (node.isClass) {
        context.hashClass(node.value)
      }
      return node
    })
  }

  /** @todo - move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   if (this.isClass) {
  //     out.add(context.hashClass(this.value.value), this.location)
  //   } else {
  //     out.add(this.value.value, this.location)
  //   }
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const loc = this.location
  //   out.add('$J.el(', loc)
  //   this.value.toModule(context, out)
  //   out.add(')')
  // }
}

/** Short form of a basic selector is a short 'el' for 'element' */
export const el = defineType(BasicSelector, 'BasicSelector', 'el')