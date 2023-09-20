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
  async eval(context: Context) {
    return await this.evalIfNot(context, async () => {
      let [left, op, right] = this.value
      if (context.shouldOperate(op)) {
        left = await left.eval(context)
        right = await right.eval(context)
        return left.operate(right, op, context)
      }
    })
  }
}

export const op = defineType(Operation, 'Operation', 'op')