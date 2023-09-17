import { defineType, type Node } from './node'
import { SimpleSelector } from './selector-simple'

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

  toString() {
    let { name, value } = this
    return `${name}${value ? `(${value})` : ''}`
  }
}

export const pseudo = defineType(PseudoSelector, 'PseudoSelector', 'pseudo')