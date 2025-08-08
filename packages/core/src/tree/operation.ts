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
    let [left, op, right] = this.value;
    if (context.shouldOperate(op)) {
      left = await left.eval(context);
      right = await right.eval(context);
      return left.operate(right, op, context);
    }
    return this.maybeClone(context);
  }
}

export const op = defineType(Operation, 'Operation', 'op');