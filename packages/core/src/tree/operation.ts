import { Node, defineType } from './node'
import type { Context } from '../context'

/** Operation is always a tuple */
export type OperationValue = [
  left: Node,
  op: '+' | '-' | '*' | '/',
  right: Node
]

/**
 * The '&' selector element
 */
export class Operation extends Node<OperationValue> {
  eval(context: Context) {
    return this
  }
}

export const op = defineType(Operation, 'Operation', 'op')