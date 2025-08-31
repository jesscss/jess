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
 * A math operation OR a value with a slash. CSS is ambiguous
 * in syntax about which is which, so we just classify `value / value`
 * as an operation.
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
    const finalize = (l: Node, r: Node): MaybePromise<Node> => {
      if (context.shouldOperate(op, l, r)) {
        let out = l.operate(r, op, context);
        out.pre = left.pre;
        out.post = right.post;
        return out;
      }
      n.value = [l, op, r];
      return n;
    };
    const handleLeft = (l: Node): MaybePromise<Node> => {
      const maybeRight = right.eval(context);
      if (isThenable(maybeRight)) {
        return (maybeRight as Promise<Node>).then((r) => {
          return finalize(l, r);
        });
      }
      const r = maybeRight as Node;
      return finalize(l, r);
    };
    if (isThenable(maybeLeft)) {
      return (maybeLeft as Promise<Node>).then(handleLeft);
    }
    return handleLeft(maybeLeft as Node);
  }
}

export const op = defineType(Operation, 'Operation', 'op');