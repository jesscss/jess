import { Node, defineType, F_VISIBLE, F_NON_STATIC  } from './node';
import type { Context } from '../context';
import type { Operator } from './util/calculate';
import { type MaybePromise, isThenable, pipe } from '@jesscss/awaitable-pipe';

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

  constructor(value: OperationValue, options?: any, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    // Operations are always non-static, but can inherit may_async from children
    this.addFlags(F_VISIBLE, F_NON_STATIC);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    let n = this;
    let [left, op, right] = n.value;
    const maybeLeft = left.eval(context);
    const handle = (l: Node): MaybePromise<Node> => {
      const maybeRight = right.eval(context);
      if (isThenable(maybeRight)) {
        return (maybeRight as Promise<Node>).then((r) => {
          if (context.shouldOperate(op)) {
            return l.operate(r, op, context);
          }
          n.value = [l, op, r];
          return n;
        });
      }
      const r = maybeRight as Node;
      if (context.shouldOperate(op)) {
        return l.operate(r, op, context);
      }
      n.value = [l, op, r];
      return n;
    };
    if (isThenable(maybeLeft)) {
      return (maybeLeft as Promise<Node>).then(handle);
    }
    return handle(maybeLeft as Node);
  }
}

export const op = defineType(Operation, 'Operation', 'op');