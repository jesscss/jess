import { defineType, type LocationInfo, type Node } from './node'
import { type TreeContext } from '../context'
import { SimpleSelector } from './selector-simple'
import { Quoted } from './quoted'
import { SelectorList } from './selector-list'

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

  normalizeSelector() {
    return new SelectorList([this])
  }

  compare(other: Node) {
    const getValue = (val: string | Node) => {
      if (typeof val === 'string') {
        return val
      }
      if (val instanceof Quoted) {
        return val.valueOf()
      }
      return val.toTrimmedString()
    }

    if (other instanceof AttributeSelector) {
      if (
        (getValue(this.key) === getValue(other.key)) &&
        (this.op === other.op) &&
        (this.mod === other.mod) &&
        (getValue(this.value ?? '') === getValue(other.value ?? ''))
      ) {
        return 0
      }
    }
    return super.compare(other)
  }
}

/** Not sure why types couldn't be properly inferred */
export const attr = defineType<AttributeSelectorValue>(AttributeSelector, 'AttributeSelector', 'attr') as (
  value: AttributeSelectorValue | Map<string, any>,
  options?: undefined,
  location?: LocationInfo | 0,
  treeContext?: TreeContext
) => AttributeSelector