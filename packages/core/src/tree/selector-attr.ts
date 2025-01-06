import { defineType, type LocationInfo, type Node, type NodeValueArray } from './node'
import { type TreeContext } from '../context'
import { SimpleSelector } from './selector-simple'
import { compare } from './util/compare'

export type AttributeSelectorValue = {
  /** The name of the attribute */
  value: string | Node
  /** The operator */
  op?: string
  /** The value of the attribute */
  attrValue?: Node
  /** The modifier (case insensitivity) */
  mod?: string
}

/**
 * An attribute selector
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors
 *   e.g. [id="foo"]
*/
export class AttributeSelector extends SimpleSelector<AttributeSelectorValue> {
  toTrimmedString() {
    let { value, op, attrValue, mod } = this.values
    return `[${value}${op ?? ''}${attrValue ?? ''}${mod ? ` ${mod}` : ''}]`
  }

  valueOf() {
    let valueOf = this._value
    if (!valueOf) {
      let { value, op, attrValue, mod } = this.values
      /** Attributes are case-insensitive */
      let keyStr = (typeof value === 'string' ? value : value.toTrimmedString()).toLowerCase()
      if (!op) {
        return `[${keyStr}]`
      }
      let valueStr = attrValue?.valueOf() ?? ''
      valueOf = this._value = `[${keyStr}${op}"${valueStr}"${mod ? ` ${mod}` : ''}]`
    }
    return valueOf
  }

  compare(other: Node) {
    const thisValue = this.valueOf()
    if (other instanceof AttributeSelector) {
      return compare(thisValue, other.valueOf())
    }
    return compare(thisValue, other)
  }
}

/** Not sure why types couldn't be properly inferred */
export const attr = defineType<AttributeSelectorValue>(AttributeSelector, 'AttributeSelector', 'attr') as (
  value: AttributeSelectorValue | Map<string, any> | NodeValueArray<AttributeSelectorValue>,
  options?: undefined,
  location?: LocationInfo | 0,
  treeContext?: TreeContext
) => AttributeSelector