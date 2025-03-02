import { defineType, type LocationInfo, type Node } from './node'
import { type TreeContext } from '../context'
import { SimpleSelector } from './selector-simple'
import { compare } from './util/compare'

export type AttributeSelectorValue = {
  /** The name of the attribute */
  name: string | Node
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
  declare value: AttributeSelectorValue
  type = 'AttributeSelector' as const
  shortType = 'attr' as const

  override toTrimmedString() {
    let { name, op, value, mod } = this.value
    return `[${name}${op ?? ''}${value ?? ''}${mod ? ` ${mod}` : ''}]`
  }

  override valueOf() {
    let valueOf = this._valueOf
    if (!valueOf) {
      let { name, op, value, mod } = this.value
      /** Attributes are case-insensitive */
      let keyStr = (typeof name === 'string' ? name : name.toTrimmedString()).toLowerCase()
      if (!op) {
        return `[${keyStr}]`
      }
      let valueStr = value?.valueOf() ?? ''
      valueOf = this._valueOf = `[${keyStr}${op}"${valueStr}"${mod ? ` ${mod}` : ''}]`
    }
    return valueOf
  }

  override compare(other: Node) {
    const thisValue = this.valueOf()
    if (other instanceof AttributeSelector) {
      return compare(thisValue, other.valueOf())
    }
    return compare(thisValue, other)
  }
}

/** Not sure why types couldn't be properly inferred */
export const attr = defineType<AttributeSelectorValue>(AttributeSelector, 'AttributeSelector', 'attr') as (
  value: AttributeSelectorValue,
  options?: undefined,
  location?: LocationInfo | 0,
  treeContext?: TreeContext
) => AttributeSelector