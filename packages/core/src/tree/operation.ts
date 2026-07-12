import { Node, defineType } from './node'
import type { Context } from '../context'
import type { Operator } from './util/calculate'

export type { Operator }
/** Operation is always a tuple */
export type OperationValue = [
  left: Node,
  op: Operator,
  right: Node
]

export type OperationOptions = {
  inCalc: boolean
}

/**
 * A math operation
 */
export class Operation extends Node<OperationValue, OperationOptions> {
  async eval(context: Context): Promise<Node> {
    let [left, op, right] = this.value
    let inCalc = this.options?.inCalc
    if (inCalc) {
      if (!this.evaluated) {
        let node = this.clone()
        left = await left.eval(context)
        right = await right.eval(context)
        node.value = [left, op, right]
        node.evaluated = true
        return node
      }
      return this
    }
    if (!left.operate) {
      throw new TypeError(`Cannot operate on ${left.type}`)
    }
    return await this.evalIfNot(context, async () => {
      if (context.shouldOperate(op)) {
        left = await left.eval(context)
        right = await right.eval(context)
        return left.operate(right, op, context)
      }
      let node = this.clone()
      node.evaluated = true
      return node
    })
  }
}

export const op = defineType(Operation, 'Operation', 'op')