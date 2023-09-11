import { Node } from './node'
import { type List } from './list'

export type CallValue = {
  /**
   * Can be an identifier or something like a mixin lookup
   *   e.g. #mixin > .class() is [Call (#mixin ())] -> [Call (class ())]
   */
  ref: string | Node
  args: List
}

/**
 * A mixin or function call. In Less, the ref for something like `rgb`
 * is not a string, but is an (optional) variable reference.
 */
export class Call extends Node<CallValue> {

}