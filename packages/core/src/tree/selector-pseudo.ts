import { defineType, type Node } from './node'
import { SimpleSelector } from './selector-simple'
import { type Context } from '../context'
import { Selector } from './selector'
import { Tuple } from '@bloomberg/record-tuple-polyfill'
import { isNode } from './util'

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

  toNormalPrimitive() {
    let { name, value } = this
    if (value && value instanceof Selector) {
      if (
        name === ':is'
        && !isNode(value, 'SelectorList')
        && (
          !isNode(value, 'ComplexSelector')
          || !isNode(value.value[0], 'Combinator')
        )
      ) {
        return value.toNormalPrimitive()
      }
      return Tuple.from([`${name}(`, value.toNormalPrimitive(), ')'])
    }
    /** Normalizes :nth-child(n + 1) to match :nth-child(n+1) */
    return `${name}${value ? `(${value.toTrimmedString().replace(/\s+/, '')})` : ''}`
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