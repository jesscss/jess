import { Node, defineType } from './node'
import { type SelectorList } from './selector-list'
import { SelectorSequence } from './selector-sequence'
import { type Context } from '../context'
import { Ampersand } from './ampersand'

export type ExtendValue = {
  /** The preceding selector */
  selector?: SelectorSequence
  /** The selector within () */
  target: SelectorSequence | SelectorList
  flag?: '!all'
}
/**
 * Extends selectors
 *
 * @todo - figure out eval -- extend should just "register"
 * selectors, to be used later in the ToCssVisitor
 * @note - there is some pseudo-code somewhere that smartly
 * registers selectors by a string code.
 */
export class Extend extends Node<ExtendValue> {
  get flag() {
    return this.data.get('flag')
  }

  get target() {
    return this.data.get('target')
  }

  set target(v: SelectorSequence | SelectorList) {
    this.data.set('target', v)
  }

  get selector() {
    let sel = this.data.get('selector')
    if (!sel) {
      sel = new SelectorSequence([new Ampersand()])
      this.data.set('selector', sel)
    }
    return sel
  }

  set selector(v: SelectorSequence) {
    this.data.set('selector', v)
  }

  get value(): SelectorSequence['value'] {
    return this.data.get('selector').value
  }

  toTrimmedString(depth?: number | undefined): string {
    let { target } = this
    let selector = this.data.get('selector')
    let output = selector ? `${selector}` : ''
    output += `:extend(${target})`
    return output
  }

  async eval(context: Context): Promise<SelectorSequence> {
    let { selector } = this
    selector = await selector.eval(context) as SelectorSequence
    /** @todo - register target */
    selector.inherit(this)
    selector.evaluated = true
    return selector
  }
}
export const extend = defineType(Extend, 'Extend')