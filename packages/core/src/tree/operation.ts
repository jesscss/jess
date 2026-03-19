import { Node, defineType, F_VISIBLE, F_NON_STATIC, F_STATIC, type NodeOptions, type LocationInfo, type TreeContext } from './node.js';
import type { Context } from '../context.js';
import type { Operator } from './util/calculate.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { getPrintOptions, type PrintOptions } from './util/print.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { Call } from './call.js';
import { list } from './list.js';

export type { Operator };
/** Operation is always a tuple */
export type OperationValue = [
  left: Node,
  op: Operator,
  right: Node
];

export interface Operation {
  type: 'Operation';
  shortType: 'op';
}
/**
 * A math operation OR a value with a slash. CSS is ambiguous
 * in syntax about which is which, so we just classify `value / value`
 * as an operation.
 */
export class Operation extends Node<OperationValue> {
  static override childKeys = ['left', 'right'] as const;

  left!: Node;
  operator!: Operator;
  right!: Node;

  override clone(deep?: boolean): this {
    const options = (this as any)._meta?.options;
    const value: OperationValue = [
      deep ? this.left.clone(deep) : this.left,
      this.operator,
      deep ? this.right.clone(deep) : this.right
    ];
    const newNode = new (this.constructor as any)(
      value,
      options ? { ...options } : undefined,
      this.location,
      this.treeContext
    );
    newNode.inherit(this);
    return newNode;
  }

  constructor(value: OperationValue, options?: NodeOptions, location?: LocationInfo, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.left = value[0];
    this.operator = value[1];
    this.right = value[2];
    if (this.left instanceof Node) {
      this.adopt(this.left);
    }
    if (this.right instanceof Node) {
      this.adopt(this.right);
    }
    // Operations are always non-static, but can inherit may_async from children
    this.addFlags(F_VISIBLE, F_NON_STATIC);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let { left, operator: op, right } = this;
    let leftStr = w.capture(() => left.toString(options));
    let rightStr = w.capture(() => right.toString(options));
    w.add(leftStr.trimEnd(), left);
    w.add(` ${op} `, this);
    w.add(rightStr.trimStart(), right);
    return w.getSince(mark);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    let n = this;
    let { left, operator: op, right } = n;
    const maybeLeft = left.eval(context);
    const finalize = (l: Node, r: Node): MaybePromise<Node> => {
      if (context.shouldOperate(op, l, r)) {
        if (isNode(l, N.Operation) || isNode(r, N.Operation)) {
          // Preserve composite expressions such as `10px / 2 * 2` when a nested
          // operation intentionally remains unevaluated under current math mode.
          n.left = l;
          n.right = r;
          return n;
        }
        const unitMode = context?.opts?.unitMode ?? 'preserve';
        const isPreserveMode = unitMode === 'preserve';

        // In preserve mode, catch unit errors and return calc() call
        if (isPreserveMode && isNode(l, N.Dimension) && isNode(r, N.Dimension)) {
          try {
            let out = l.operate(r, op, context);
            out.pre = left.pre;
            out.post = right.post;
            return out;
          } catch (error) {
            // If it's a unit error (TypeError), return calc(operation)
            if (error instanceof TypeError) {
              // Update the existing operation with evaluated nodes and mark as evaluated
              n.left = l;
              n.right = r;
              n.evaluated = true;
              // Mark child nodes as evaluated too
              l.evaluated = true;
              r.evaluated = true;
              const calcCall = new Call({ name: 'calc', args: list([n]) });
              calcCall.pre = left.pre;
              calcCall.post = right.post;
              return calcCall;
            }
            // Re-throw non-unit errors
            throw error;
          }
        }

        let out: Node;
        try {
          out = l.operate(r, op, context);
        } catch (error) {
          throw error;
        }
        out.pre = left.pre;
        out.post = right.post;
        return out;
      }
      n.left = l;
      n.right = r;
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
