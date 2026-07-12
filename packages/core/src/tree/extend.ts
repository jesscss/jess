import { defineType } from './node'
import { type SelectorList } from './selector-list'
import { type ComplexSelector } from './selector-complex'
import { type Context } from '../context'
import { Selector } from './selector'
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
export class Extend extends Selector<ExtendValue> {
  get flag(): ExtendFlag | undefined {
    return this.data.get('flag')
  }

  get target() {
    return this.data.get('target')
  }

  set target(v: ComplexSelector | SelectorList) {
    this.data.set('target', v)
  }

  get value(): Selector | Nil {
    return this.data.get('value')
  }

  toTrimmedString(depth?: number | undefined): string {
    let { target } = this
    let selector = this.data.get('selector')
    let output = selector ? `${selector}` : ''
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
export const extend = defineType(Extend, 'Extend')