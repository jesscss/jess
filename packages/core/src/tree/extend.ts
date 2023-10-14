import { Node, defineType } from './node'
import { type SelectorList } from './selector-list'
import { SelectorSequence } from './selector-sequence'
import { type Context } from '../context'
import { Ampersand } from './ampersand'

export type ExtendValue = {
  target?: SelectorSequence
  extendList: SelectorSequence | SelectorList
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
  get target() {
    return this.data.get('target')
  }

  set target(v: SelectorSequence | undefined) {
    this.data.set('target', v)
  }

  get extendList() {
    return this.data.get('extendList')
  }

  set extendList(v: SelectorSequence | SelectorList) {
    this.data.set('extendList', v)
  }

  get value() {
    return this.data.get('target')?.value
  }

  toTrimmedString(depth?: number | undefined): string {
    let { target, extendList } = this
    let output = target ? `${target}` : ''
    output += `:extend(${extendList})`
    return output
  }

  async eval(context: Context): Promise<SelectorSequence> {
    let { target, extendList } = this
    target ??= new SelectorSequence([new Ampersand()])
    target = await target.eval(context) as SelectorSequence
    /** @todo - register extendList */
    target.inherit(this)
    target.evaluated = true
    return target
  }
}
export const extend = defineType(Extend, 'Extend')