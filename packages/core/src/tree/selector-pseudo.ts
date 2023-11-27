import { defineType, type Node } from './node'
import { SimpleSelector } from './selector-simple'
import { type Context } from '../context'
import { type Selector } from './selector'

export type PseudoSelectorValue = {
  /**
   * The name of the pseudo-selector
   * @note - this will contain the `:` prefix,
   * to support `::before` and `::after`
   */
  name: string
  /** The value of a function-like pseudo-selector */
  value?: Node
}

/**
 * A pseudo selector
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors
 *   e.g. [id="foo"]
*/
export class PseudoSelector extends SimpleSelector<PseudoSelectorValue> {
  get name() {
    return this.data.get('name')
  }

  set name(v: string) {
    this.data.set('name', v)
  }

  toTrimmedString() {
    let { name, value } = this
    return `${name}${value ? `(${value})` : ''}`
  }

  toPrimitiveSelector() {
    let { name, value } = this
    if (/:(is|where)/.test(name)) {
      return (value as Selector).toPrimitiveSelector()
    }
    return this.toTrimmedString()
  }

  async eval(context: Context) {
    return await this.evalIfNot(context, async () => {
      let { value } = this
      let node = this.clone()
      if (!value) {
        return node
      }
      let canOperate = context.canOperate
      /** Reset parentheses "state" */
      context.canOperate = false
      value = await value.eval(context)
      context.canOperate = canOperate
      node.value = value
      return node
    })
  }
}

export const pseudo = defineType<PseudoSelectorValue, typeof PseudoSelector>(PseudoSelector, 'PseudoSelector', 'pseudo')