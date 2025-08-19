import { Node, defineType } from './node';
import type { Context } from '../context';
import type { Operator } from './util/calculate';

export type { Operator };
/** Operation is always a tuple */
export type OperationValue = [
  left: Node,
  op: Operator,
  right: Node
];

/**
 * A math operation
 */
export class Operation extends Node<OperationValue> {
  type = 'Operation' as const;
  shortType = 'op' as const;

  override async evalNode(context: Context): Promise<Node> {
    let n = this.maybeClone(context);
    let [left, op, right] = n.value;
    left = await left.eval(context);
    right = await right.eval(context);
    if (context.shouldOperate(op)) {
      let result = left.operate(right, op, context);
      return result.inherit(this);
    }
    n.value = [left, op, right];
    return n;
  }
}

export const op = defineType(Operation, 'Operation', 'op');