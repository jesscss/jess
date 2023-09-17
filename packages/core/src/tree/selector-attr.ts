import { defineType, type Node } from './node'
import { SimpleSelector } from './selector-simple'

export type AttributeSelectorValue = {
  /** The name of the attribute */
  key: string | Node
  /** The operator */
  op?: string
  /** The value of the attribute */
  value?: Node
  /** The modifier (case insensitivity) */
  mod?: string
}

/**
 * An attribute selector
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors
 *   e.g. [id="foo"]
*/
export class AttributeSelector extends SimpleSelector<AttributeSelectorValue> {
  get key() {
    return this.data.get('key')
  }

  set key(v: string | Node) {
    this.data.set('key', v)
  }

  get op() {
    return this.data.get('op')
  }

  set op(v: string | undefined) {
    this.data.set('op', v)
  }

  get mod() {
    return this.data.get('mod')
  }

  set mod(v: string | undefined) {
    this.data.set('mod', v)
  }

  toString() {
    let { key, op, value, mod } = this
    return `[${key}${op ?? ''}${value ?? ''}${mod ? ` ${mod}` : ''}]`
  }
}

export const attr = defineType(AttributeSelector, 'AttributeSelector', 'attr')