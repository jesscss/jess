import { Node, defineType } from './node'
import { type List } from './list'

export type CallValue = {
  /**
   * Can be an identifier or something like a mixin lookup
   *   e.g. #mixin > .class() is [Call (#mixin ())] -> [Call (class ())]
   */
  ref: string | Node
  args?: List
}

/**
 * A mixin or function call. In Less, the ref for something like `rgb`
 * is not a string, but is an (optional) variable reference.
 */
export class Call extends Node<CallValue> {
  get ref() {
    return this.data.get('ref')
  }

  set ref(v: string | Node) {
    this.data.set('ref', v)
  }

  get args() {
    return this.data.get('args')
  }

  set args(v: List | undefined) {
    this.data.set('args', v)
  }

  toTrimmedString() {
    let { ref, args } = this
    return `${ref}(${args ?? ''})`
  }
}

export const call = defineType(Call, 'Call')