import { Node, defineType, F_VISIBLE, F_NON_STATIC, F_STATIC  } from './node.js';
import type { Context } from '../context.js';
import type { Operator } from './util/calculate.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { getPrintOptions, type PrintOptions } from './util/print.js';
import { isNode } from './util/is-node.js';
import { Call } from './call.js';

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

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let [left, op, right] = this.value;
    let leftStr = w.capture(() => left.toString(options));
    let rightStr = w.capture(() => right.toString(options));
    w.add(leftStr.trimEnd(), left);
    w.add(` ${op} `, this);
    w.add(rightStr.trimStart(), right);
    return w.getSince(mark);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    let n = this;
    let [left, op, right] = n.value;
    const maybeLeft = left.eval(context);
    const finalize = (l: Node, r: Node): MaybePromise<Node> => {
      if (context.shouldOperate(op, l, r)) {
        const unitMode = context?.opts?.unitMode ?? 'preserve';
        const isPreserveMode = unitMode === 'preserve';

        // In preserve mode, catch unit errors and return calc() call
        if (isPreserveMode && isNode(l, 'Dimension') && isNode(r, 'Dimension')) {
          try {
            let out = l.operate(r, op, context);
            out.pre = left.pre;
            out.post = right.post;
            return out;
          } catch (error) {
            // If it's a unit error (TypeError), return calc(operation)
            if (error instanceof TypeError) {
              // Update the existing operation with evaluated nodes and mark as evaluated
              n.value = [l, op, r];
              n.evaluated = true;
              // Mark child nodes as evaluated too
              l.evaluated = true;
              r.evaluated = true;
              const calcCall = new Call({ name: 'calc', args: [n] });
              calcCall.pre = left.pre;
              calcCall.post = right.post;
              return calcCall;
            }
            // Re-throw non-unit errors
            throw error;
          }
        }

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