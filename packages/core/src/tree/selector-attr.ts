import { defineType, type LocationInfo, type Node, type NodeValueArray } from './node'
import { type TreeContext } from '../context'
import { SimpleSelector } from './selector-simple'
import { compare } from './util/compare'

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

  get mod(): string {
    const thisMod = this.data.get('mod')
    if (thisMod) {
      return thisMod
    }
    return ''
  }

  set mod(v: string | undefined) {
    this.data.set('mod', v)
  }

  toTrimmedString() {
    let { key, op, value, mod } = this
    return `[${key}${op ?? ''}${value ?? ''}${mod ? ` ${mod}` : ''}]`
  }

  valueOf() {
    let valueOf = this._value
    if (!valueOf) {
      let { key, op, value, mod } = this
      /** Attributes are case-insensitive */
      let keyStr = (typeof key === 'string' ? key : key.toTrimmedString()).toLowerCase()
      if (!op) {
        return `[${keyStr}]`
      }
      let valueStr = value?.valueOf() ?? ''
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