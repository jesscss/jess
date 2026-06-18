import { Node, defineType, F_VISIBLE, F_NON_STATIC, type NodeLocation, type NodeOptions } from './node.js';
import type { Context } from '../context.js';
import type { Operator } from './util/calculate.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { getPrintOptions, type FinalPrintOptions, type PrintOptions } from './util/print.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { Call } from './call.js';
import { list } from './list.js';
import { consumeTrivia, emitTriviaTokens } from './util/trivia.js';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  writeRenderText,
  type RenderBuffer
} from './util/render-buffer.js';
import { copyOwnedWithReusableLeaves } from './util/cloning.js';

export type { Operator };
/** Operation is always a tuple */
export type OperationValue = [
  left: Node,
  op: Operator,
  right: Node
];

type OperationRenderResult =
  | Node
  | {
    left: Node;
    right: Node;
  };

/**
 * A math operation OR a value with a slash. CSS is ambiguous
 * in syntax about which is which, so we just classify `value / value`
 * as an operation.
 */
export class Operation extends Node<OperationValue> {
  static override childKeys = ['left', 'right'] as const;

  readonly left: Node;
  readonly operator: Operator;
  readonly right: Node;

  private static isPreservedSlashList(node: Node): boolean {
    return isNode(node, N.List) && (node as Node & { options?: { sep?: string } }).options?.sep === '/';
  }

  private withOperands(left: Node, right: Node): Operation {
    const finalLeft = left === this.left ? copyOwnedWithReusableLeaves(left) : left;
    const finalRight = right === this.right ? copyOwnedWithReusableLeaves(right) : right;
    const node = new Operation(
      [finalLeft, this.operator, finalRight],
      this._options ? { ...this._options } : undefined,
      this.location,
      this._treeContext
    );
    return node.inherit(this);
  }

  private createCalcFallback(left: Node, right: Node): Call {
    const operationNode = this.withOperands(left, right);
    operationNode.evaluated = true;
    return (new Call(
      { name: 'calc', args: list([operationNode]) },
      undefined,
      undefined,
      this.sourceRoot?._treeContext
    )).inherit(this);
  }

  constructor(
    value: OperationValue,
    options?: NodeOptions,
    location?: NodeLocation,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    this.left = value[0];
    this.operator = value[1];
    this.right = value[2];
    this._treeContext = treeContext;
    // Operations are always non-static, but can inherit may_async from children
    this.addFlags(F_VISIBLE, F_NON_STATIC);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer!;
    const { left, operator: op, right } = this;
    const leftMark = w.mark();
    left.writeSyntax(options);
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
      right.writeSyntax(options);
    } finally {
      options.suppressBoundaryTrivia = saved;
    }
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    this.writeSyntax(options);
    return w.getSince(mark);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const output = this.evaluateRenderOperands(context);
    return isThenable(output)
      ? (output as Promise<OperationRenderResult>).then(result => this.renderEvaluatedOutput(context, result, bufferOrOptions, options))
      : this.renderEvaluatedOutput(context, output as OperationRenderResult, bufferOrOptions, options);
  }

  private evaluateRenderOperands(context: Context): MaybePromise<OperationRenderResult> {
    const { left, operator: op, right } = this;
    const maybeLeft = left.eval(context);
    const finalize = (l: Node, r: Node): MaybePromise<OperationRenderResult> => {
      const renderOperands = (): OperationRenderResult => {
        return l === left && r === right
          ? this
          : { left: l, right: r };
      };
      if (Operation.isPreservedSlashList(l) || Operation.isPreservedSlashList(r)) {
        return renderOperands();
      }
      if (context.shouldOperate(op, l, r)) {
        if (isNode(l, N.Operation) || isNode(r, N.Operation)) {
          return renderOperands();
        }
        const unitMode = context?.opts?.unitMode ?? 'preserve';
        const isPreserveMode = unitMode === 'preserve';
        if (isPreserveMode && isNode(l, N.Dimension) && isNode(r, N.Dimension)) {
          try {
            let out = l.operate(r, op, context);
            out.inherit(this);
            return out;
          } catch (error) {
            if (error instanceof TypeError) {
              return this.createCalcFallback(l, r);
            }
            throw error;
          }
        }
        let out: Node;
        try {
          out = l.operate(r, op, context);
        } catch (error) {
          throw error;
        }
        return out.inherit(this);
      }
      return renderOperands();
    };
    const handleLeft = (l: Node): MaybePromise<OperationRenderResult> => {
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

  private renderEvaluatedOutput(
    context: Context,
    output: OperationRenderResult,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): MaybePromise<string> {
    if (output instanceof Node) {
      return this.renderOutput(context, output, bufferOrOptions, options);
    }
    const renderBuffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const explicitWriter = renderBuffer ? undefined : bufferOrOptions?.writer;
    const printOptions = renderBuffer
      ? prepareBufferPrintState(context, options)
      : explicitWriter
        ? prepareBufferPrintState(context, bufferOrOptions)
        : bufferOrOptions;
    const finish = (leftOut: string): MaybePromise<string> => {
      const right = output.right.render(context, printOptions);
      const combine = (rightOut: string): string => `${leftOut} ${this.operator} ${rightOut}`;
      return isThenable(right)
        ? right.then(combine)
        : combine(right);
    };
    const left = output.left.render(context, printOptions);
    const rendered = isThenable(left)
      ? left.then(finish)
      : finish(left);
    if (!renderBuffer && !explicitWriter) {
      return rendered;
    }
    return isThenable(rendered)
      ? (rendered as Promise<string>).then((out) => {
          if (renderBuffer) {
            return writeRenderText(renderBuffer, out);
          }
          explicitWriter!.add(out, this);
          return out;
        })
      : renderBuffer
        ? writeRenderText(renderBuffer, rendered as string)
        : (() => {
            explicitWriter!.add(rendered as string, this);
            return rendered as string;
          })();
  }

  private evaluateOperands(context: Context): MaybePromise<Node> {
    let n = this;
    const { left, operator: op, right } = n;
    const maybeLeft = left.eval(context);
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
              return n.createCalcFallback(l, r);
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

  override evalNode(context: Context): MaybePromise<Node> {
    return this.evaluateOperands(context);
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evaluateOperands(context);
  }
}

export const op = defineType(Operation, 'Operation', 'op');
