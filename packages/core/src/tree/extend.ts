import { defineType, Node } from './node'
import { type Context } from '../context'
import { type Selector } from './selector'
import { type Nil } from './nil'

export const enum ExtendFlag {
  All = 1
}

export type ExtendValue = {
  /** The preceding selector */
  value: Selector | Nil
  /** The selector within () */
  target: Selector
  flag?: ExtendFlag
}
/**
 * Extends selectors
 *
 * @todo - figure out eval -- extend should just "register"
 * selectors, to be used later in the ToCssVisitor
 * @note - there is some pseudo-code somewhere that smartly
 * registers selectors by a string code.
 */
export class Extend extends Node<ExtendValue> implements Selector {
  declare isSelector: true

  _valueOf: string | undefined
  valueOf() {
    return `:extend(${this.value.valueOf()})`
  }

  /** The preceding selector is the keyset */
  get keySet() {
    return this.data.get('value').keySet
  }

  toTrimmedString(depth?: number | undefined): string {
    let { target, value } = this.values
    let output = value ? `${value}` : ''
    output += `:extend(${target})`
    return output
  }

  toPrimitiveSelector() {
    return this.data.get('value').toPrimitiveSelector()
  }

  async eval(context: Context): Promise<Selector> {
    let { value } = this
    value = await value.eval(context) as Selector
    /** @todo - register target */
    value.inherit(this)
    value.evaluated = true
    return value
  }
}
Extend.prototype.isSelector = true
export const extend = defineType(Extend, 'Extend')