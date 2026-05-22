import { Node, defineType, F_VISIBLE, F_NON_STATIC, type NodeLocation, type NodeOptions, type TreeContext } from './node.js';
import type { Context } from '../context.js';
import type { Operator } from './util/calculate.js';
import { type MaybePromise, isThenable, pipe } from '@jesscss/awaitable-pipe';
import { getPrintOptions, type PrintOptions } from './util/print.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { Call } from './call.js';
import { list } from './list.js';
import { consumeTrivia, emitTriviaTokens } from './util/trivia.js';
import {
  renderSourceOutput,
  type RenderBuffer
} from './util/render-buffer.js';
import { copyWithReusableLeaves } from './util/cloning.js';

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
  private static isPreservedSlashList(node: Node): boolean {
    return isNode(node, N.List) && (node as Node & { options?: { sep?: string } }).options?.sep === '/';
  }

  private withOperands(left: Node, right: Node): Operation {
    const finalLeft = left === this.value[0] ? copyWithReusableLeaves(left) : left;
    const finalRight = right === this.value[2] ? copyWithReusableLeaves(right) : right;
    const node = new Operation(
      [finalLeft, this.value[1], finalRight],
      this._options ? { ...this._options } : undefined,
      this.location,
      this.treeContext
    );
    return node.inherit(this);
  }

  constructor(value: OperationValue, options?: NodeOptions, location?: NodeLocation, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    // Operations are always non-static, but can inherit may_async from children
    this.addFlags(F_VISIBLE, F_NON_STATIC);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let [left, op, right] = this.value;
    const leftMark = w.mark();
    left.toString(options);
    w.trimEndSince(leftMark);
    w.add(` ${op} `, this);
    if (options.trivia) {
      emitTriviaTokens(
        consumeTrivia(options.trivia, right.location[0], 'before', options),
        options,
        { skipLeadingWhitespace: true }
      );
    }
    const saved = options.suppressBoundaryTrivia;
    options.suppressBoundaryTrivia = 'pre';
    try {
      right.toString(options);
    } finally {
      options.suppressBoundaryTrivia = saved;
    }
    return w.getSince(mark);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    return pipe(
      () => this.evaluateOperands(context, 'resolve'),
      node => renderSourceOutput(context, node, bufferOrOptions, options)
    );
  }

  private evaluateOperands(context: Context, mode: 'eval' | 'resolve'): MaybePromise<Node> {
    let n = this;
    let [left, op, right] = n.value;
    const maybeLeft = mode === 'eval' ? left.eval(context) : left.resolve(context);
    const finalize = (l: Node, r: Node): MaybePromise<Node> => {
      if (Operation.isPreservedSlashList(l) || Operation.isPreservedSlashList(r)) {
        if (l === left && r === right) {
          return n;
        }
        return n.withOperands(l, r);
      }
      if (context.shouldOperate(op, l, r)) {
        if (isNode(l, N.Operation) || isNode(r, N.Operation)) {
          // Preserve composite expressions such as `10px / 2 * 2` when a nested
          // operation intentionally remains unevaluated under current math mode.
          if (l === left && r === right) {
            return n;
          }
          return n.withOperands(l, r);
        }
        const unitMode = context?.opts?.unitMode ?? 'preserve';
        const isPreserveMode = unitMode === 'preserve';

        // In preserve mode, catch unit errors and return calc() call
        if (isPreserveMode && isNode(l, N.Dimension) && isNode(r, N.Dimension)) {
          try {
            let out = l.operate(r, op, context);
            out.inherit(n);
            return out;
          } catch (error) {
            // If it's a unit error (TypeError), return calc(operation)
            if (error instanceof TypeError) {
              const operationNode = (l === left && r === right)
                ? n
                : n.withOperands(l, r);
              operationNode.evaluated = true;
              // Mark child nodes as evaluated too
              l.evaluated = true;
              r.evaluated = true;
              const calcCall = new Call({ name: 'calc', args: list([operationNode]) });
              return calcCall.inherit(n);
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
        return out.inherit(n);
      }
      if (l === left && r === right) {
        return n;
      }
      return n.withOperands(l, r);
    };
    const handleLeft = (l: Node): MaybePromise<Node> => {
      const maybeRight = mode === 'eval' ? right.eval(context) : right.resolve(context);
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

  override evalNode(context: Context): MaybePromise<Node> {
    return this.evaluateOperands(context, 'eval');
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evaluateOperands(context, 'resolve');
  }
}

export const op = defineType(Operation, 'Operation', 'op');
