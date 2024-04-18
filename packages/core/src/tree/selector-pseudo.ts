import { defineType, type Node } from './node'
import { SimpleSelector } from './selector-simple'
import { type Context } from '../context'
import { Selector } from './selector'
import { isNode } from './util'
import { type SelectorList } from './selector-list'
import { Ampersand } from './ampersand'
import { Combinator } from './combinator'

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

const { isArray } = Array

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

  get keys() {
    let keys = this._keys
    if (!keys) {
      let { value, name } = this
      if (value && value instanceof Selector) {
        if (name === ':is') {
          const isNotRelative = (sel: Selector) => {
            let match = false
            sel.walkNodes(node => {
            /** Stop at the first simple selector or combinator */
              if (node instanceof SimpleSelector) {
                if (node instanceof Ampersand) {
                  match = true
                }
                return false
              } else if (node instanceof Combinator) {
                match = true
                return false
              }
            })
            return !match
          }
          if (isNode(value, 'SelectorList')) {
            if (
              /**
               * If an :is starts with an ampersand or combinator,
               * it's relative, and can't be flattened.
               */
              (value as SelectorList).value.every(isNotRelative)
            ) {
              keys = (value as SelectorList).value.flatMap(sel => sel.keys)
            } else {
              keys = this.valueOf()
            }
          } else if (isNotRelative(value)) {
            keys = value.keys
          } else {
            keys = this.valueOf()
          }
          this._keys = keys
          return keys
        } else {
          keys = this.valueOf()
        }
      } else {
        keys = this.valueOf()
      }
      this._keys = keys
    }
    return keys
  }

  valueOf() {
    let valueOf = this._value
    if (!valueOf) {
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
          valueOf = value.valueOf()
        } else {
          valueOf = `${name}(${value.valueOf()})`
        }
      } else {
        /**
         * Normalizes :nth-child(n + 1) to match :nth-child(n+1)
         * That is, anything that doesn't hold a selector as a value
         * is, by definition, not space-sensitive.
         */
        valueOf = `${name}${value ? `(${value.valueOf().replace(/\s+/, '')})` : ''}`
      }
      this._value = valueOf
    }
    return valueOf
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