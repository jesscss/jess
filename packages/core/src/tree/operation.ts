import { Node, defineType, F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC, type NodeLocation, type NodeOptions } from './node.js';
import type { Context } from '../context.js';
import type { Operator } from './util/calculate.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { type FinalPrintOptions, getPrintOptions, type PrintOptions } from './util/print.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { Call } from './call.js';
import { list } from './list.js';
import { consumeTrivia, emitTriviaTokens } from './util/trivia.js';
import { isRenderBuffer, writeRenderText, type RenderBuffer } from './util/render-buffer.js';
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
  private static isPreservedSlashList(node: Node): boolean {
    return isNode(node, N.List) && (node as Node & { options?: { sep?: string } }).options?.sep === '/';
  }

  private withOperands(left: Node, right: Node): Operation {
    const finalLeft = left === this.value[0] ? copyOwnedWithReusableLeaves(left) : left;
    const finalRight = right === this.value[2] ? copyOwnedWithReusableLeaves(right) : right;
    const node = new Operation(
      [finalLeft, this.value[1], finalRight],
      this._options ? { ...this._options } : undefined,
      this.location
    );
    return node.inherit(this);
  }

  private createCalcFallback(left: Node, right: Node, baseLeft: Node, baseRight: Node): Call {
    const operationNode = (left === baseLeft && right === baseRight)
      ? this
      : this.withOperands(left, right);
    operationNode.evaluated = true;
    left.evaluated = true;
    right.evaluated = true;
    return (new Call({ name: 'calc', args: list([operationNode]) })).inherit(this);
  }

  constructor(value: OperationValue, options?: NodeOptions, location?: NodeLocation) {
    super(value, options, location);
    // Operations are always non-static, but can inherit may_async from children
    this.addFlags(F_VISIBLE, F_NON_STATIC);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    let [left, op, right] = this.value;
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
    right.writeSyntax(options);
    options.suppressBoundaryTrivia = saved;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const mark = options.writer.mark();
    this.writeSyntax(options);
    const w = options.writer;
    return w.getSince(mark);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const output = this.evaluateRenderOperands(context);
    return isThenable(output)
      ? output.then(result => this.renderEvaluatedOutput(context, result, bufferOrOptions, options))
      : this.renderEvaluatedOutput(context, output, bufferOrOptions, options);
  }

  private evaluateRenderOperands(context: Context): MaybePromise<OperationRenderResult> {
    const [left] = this.value;
    const maybeLeft = left.hasFlag(F_MAY_ASYNC)
      ? left.eval(context)
      : left.evalImmediateSync(context);
    if (isThenable(maybeLeft)) {
      return maybeLeft.then(leftNode => this.evaluateRenderRight(context, leftNode));
    }
    return this.evaluateRenderRight(context, maybeLeft);
  }

  private evaluateRenderRight(context: Context, left: Node): MaybePromise<OperationRenderResult> {
    const right = this.value[2];
    const maybeRight = right.hasFlag(F_MAY_ASYNC)
      ? right.eval(context)
      : right.evalImmediateSync(context);
    return isThenable(maybeRight)
      ? maybeRight.then(rightNode => this.finalizeRenderOperands(context, left, rightNode))
      : this.finalizeRenderOperands(context, left, maybeRight);
  }

  private finalizeRenderOperands(context: Context, left: Node, right: Node): OperationRenderResult {
    const [sourceLeft, op, sourceRight] = this.value;
    if (
      Operation.isPreservedSlashList(left)
      || Operation.isPreservedSlashList(right)
      || isNode(left, N.Operation)
      || isNode(right, N.Operation)
      || !context.shouldOperate(op, left, right)
    ) {
      return left === sourceLeft && right === sourceRight
        ? this
        : { left, right };
    }
    if (
      (context.opts.unitMode ?? 'preserve') === 'preserve'
      && isNode(left, N.Dimension)
      && isNode(right, N.Dimension)
    ) {
      try {
        const out = left.operate(right, op, context);
        return out.inherit(this);
      } catch (error) {
        if (error instanceof TypeError) {
          return this.createCalcFallback(left, right, sourceLeft, sourceRight);
        }
        throw error;
      }
    }
    return left.operate(right, op, context).inherit(this);
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
    const printOptions = isRenderBuffer(bufferOrOptions)
      ? this.bufferChildPrintOptions(options)
      : bufferOrOptions;
    const left = output.left.render(context, printOptions);
    const rendered = isThenable(left)
      ? left.then(leftOut => this.renderEvaluatedRight(output.right, leftOut, context, printOptions))
      : this.renderEvaluatedRight(output.right, left, context, printOptions);
    if (!isRenderBuffer(bufferOrOptions)) {
      return rendered;
    }
    return isThenable(rendered)
      ? rendered.then(out => writeRenderText(bufferOrOptions, out))
      : writeRenderText(bufferOrOptions, rendered);
  }

  private bufferChildPrintOptions(options?: PrintOptions): PrintOptions | undefined {
    if (!options?.writer) {
      return options;
    }
    const detached = { ...options };
    delete detached.writer;
    return detached;
  }

  private renderEvaluatedRight(
    right: Node,
    leftOut: string,
    context: Context,
    options?: PrintOptions
  ): MaybePromise<string> {
    const rendered = right.render(context, options);
    return isThenable(rendered)
      ? rendered.then(rightOut => `${leftOut} ${this.value[1]} ${rightOut}`)
      : `${leftOut} ${this.value[1]} ${rendered}`;
  }

  private evaluateOperands(context: Context): MaybePromise<Node> {
    const [left] = this.value;
    const maybeLeft = left.hasFlag(F_MAY_ASYNC)
      ? left.eval(context)
      : left.evalImmediateSync(context);
    if (isThenable(maybeLeft)) {
      return maybeLeft.then(leftNode => this.evaluateRight(context, leftNode));
    }
    return this.evaluateRight(context, maybeLeft);
  }

  private evaluateRight(context: Context, left: Node): MaybePromise<Node> {
    const right = this.value[2];
    const maybeRight = right.hasFlag(F_MAY_ASYNC)
      ? right.eval(context)
      : right.evalImmediateSync(context);
    return isThenable(maybeRight)
      ? maybeRight.then(rightNode => this.finalizeOperands(context, left, rightNode))
      : this.finalizeOperands(context, left, maybeRight);
  }

  private finalizeOperands(context: Context, left: Node, right: Node): Node {
    const [sourceLeft, op, sourceRight] = this.value;
    if (
      Operation.isPreservedSlashList(left)
      || Operation.isPreservedSlashList(right)
      || isNode(left, N.Operation)
      || isNode(right, N.Operation)
      || !context.shouldOperate(op, left, right)
    ) {
      return left === sourceLeft && right === sourceRight
        ? this
        : this.withOperands(left, right);
    }
    if (
      (context.opts.unitMode ?? 'preserve') === 'preserve'
      && isNode(left, N.Dimension)
      && isNode(right, N.Dimension)
    ) {
      try {
        const out = left.operate(right, op, context);
        return out.inherit(this);
      } catch (error) {
        if (error instanceof TypeError) {
          return this.createCalcFallback(left, right, sourceLeft, sourceRight);
        }
        throw error;
      }
    }
    return left.operate(right, op, context).inherit(this);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    return this.evaluateOperands(context);
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evaluateOperands(context);
  }
}

export const op = defineType(Operation, 'Operation', 'op');
