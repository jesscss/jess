import { spanStartOf, sourceSpanOf } from './util/provenance.js';
import { Node, defineType, F_VISIBLE, F_NON_STATIC, type NodeLocation, type NodeOptions } from './node.js';
import type { Context } from '../context.js';
import type { Operator } from './util/calculate.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { getPrintOptions, type FinalPrintOptions, type PrintOptions } from './util/print.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { Dimension } from './dimension.js';
import { Color } from './color.js';
import { Call, isCalcCall } from './call.js';
import { list } from './list.js';
import { consumeTrivia, emitTriviaTokens } from './util/trivia.js';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  writeRenderText,
  type RenderBuffer
} from './util/render-buffer.js';

export type { Operator };
/** Operation is always a tuple */
export type OperationValue = [
  left: string | Node,
  op: Operator,
  right: string | Node
];

type OperationRenderResult =
  | Node
  | {
    left: Node;
    right: Node;
  };

/** `1px`, `.5em`, `-3`, `10%` — a numeric value terminal with an optional unit. */
const NUMERIC_KEYWORD_RE = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i;

/**
 * A parser value terminal like `1px` can arrive as a `Keyword`/`Any` string
 * node. Recast a numeric-text keyword operand to an operable Dimension/Color so
 * arithmetic works; leave true keywords untouched.
 */
function recastNumericOperand(node: Node): Node {
  if (isNode(node, N.Any)) {
    const value = (node as { value?: unknown }).value;
    if (typeof value === 'string') {
      if (value.startsWith('#')) {
        return new Color(value).inherit(node);
      }
      const match = NUMERIC_KEYWORD_RE.exec(value);
      if (match) {
        return new Dimension({ number: parseFloat(match[1]!), unit: match[2] }).inherit(node);
      }
    }
  }
  return node;
}

/**
 * A math operation OR a value with a slash. CSS is ambiguous
 * in syntax about which is which, so we just classify `value / value`
 * as an operation.
 */
export class Operation extends Node<OperationValue> {
  static override childKeys = ['left', 'right'] as const;

  readonly left: string | Node;
  readonly operator: Operator;
  readonly right: string | Node;

  private static isPreservedSlashList(node: Node): boolean {
    return isNode(node, N.List) && (node as Node & { options?: { sep?: string } }).options?.sep === '/';
  }

  // A Paren operand that survives eval (e.g. `(25vh - 20px)`, incompatible
  // units under calc/preserve) is not a single operable terminal — its inner
  // expression stays parenthesized on output. Treat it like a nested Operation:
  // preserve the operation rather than trying to operate on the Paren.
  private static isUnoperable(node: Node): boolean {
    // A preserved `calc(...)` Call (produced by createCalcFallback when
    // `operate()` throws on incompatible units) is not a single operable
    // terminal either. Recognizing it here routes `calc(X) op Y` through the
    // compose path so it nests into a calc rather than stringifying to an Any.
    return isNode(node, N.Operation) || isNode(node, N.Paren) || isCalcCall(node);
  }

  // A preserved calc holds a single inner value as its only arg (`calc(l op r)`
  // or, for an explicit `calc(@x)` wrapping an already-preserved calc,
  // `calc((l op r))`). CSS flattens nested calc, so when this operand is such a
  // calc we splice its inner value directly into the composing operation —
  // yielding one flat `calc(...)` instead of `calc(calc(...) op Y)` (which
  // renders with a redundant paren and, when the calc Call stayed as the
  // operand, mis-serialized the wrapping operation).
  //
  // A bare inner Operation is spliced in directly. A Paren-wrapped inner
  // expression keeps its Paren (precedence-safe) — `calc((a - b)) + 1`
  // composes to `calc((a - b) + 1)`, never dropping the paren and changing
  // meaning. A nested calc Call is unwrapped recursively.
  private static unwrapCalcOperand(node: Node): Node {
    if (isCalcCall(node)) {
      const args = (node as Call).args;
      if (args && args.value.length === 1) {
        const inner = args.value[0]!;
        if (isNode(inner, N.Operation)) {
          return inner;
        }
        if (isNode(inner, N.Paren) || isCalcCall(inner)) {
          return Operation.unwrapCalcOperand(inner);
        }
      }
    }
    return node;
  }

  private withOperands(left: Node, right: Node): Operation {
    const node = new Operation(
      [left, this.operator, right],
      this._options ? { ...this._options } : undefined,
      sourceSpanOf(this)
    );
    return node.inherit(this);
  }

  private createCalcFallback(left: Node, right: Node): Call {
    const operationNode = this.withOperands(left, right);
    return (new Call(
      { name: 'calc', args: list([operationNode]) },
      undefined,
      undefined
    )).inherit(this);
  }

  constructor(
    value: OperationValue,
    options?: NodeOptions,
    location?: NodeLocation
  ) {
    super(value, options, location);
    this.left = value[0];
    this.operator = value[1];
    this.right = value[2];
    // Operations are always non-static, but inherit may_async from their
    // operands so an operation wrapping an async child (e.g. a nested `calc()`
    // Call) is itself scheduled on the async path.
    this.addFlags(F_VISIBLE, F_NON_STATIC);
    if (this.left instanceof Node) {
      this.propagateFlagsFrom(this.left);
    }
    if (this.right instanceof Node) {
      this.propagateFlagsFrom(this.right);
    }
  }

  protected override ownStaticFlag(): number {
    return F_NON_STATIC;
  }

  // Operation's value is a positional `[left, op, right]` tuple, so the base's
  // childKeys object-rebuild doesn't fit — own the clone (invariant 7).
  override clone(cloneFn?: (n: Node) => Node): this {
    const left = cloneFn && this.left instanceof Node ? cloneFn(this.left) : this.left;
    const right = cloneFn && this.right instanceof Node ? cloneFn(this.right) : this.right;
    const node = new Operation(
      [left, this.operator, right],
      this._options ? { ...this._options } : undefined,
      sourceSpanOf(this)
    );
    node.inherit(this);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return node as this;
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer!;
    const { left, operator: op, right } = this;
    // String operands are adjacent already-final terminals (e.g. `U+??????`
    // unicode-range segments) — serialize verbatim with no math spacing.
    const terminal = typeof left === 'string' || typeof right === 'string';
    const leftMark = w.mark();
    if (typeof left === 'string') {
      w.add(left, this);
    } else {
      left.writeSyntax(options);
    }
    w.trimEndSince(leftMark);
    w.add(terminal ? op : ` ${op} `, this);
    if (typeof right !== 'string' && options.trivia) {
      emitTriviaTokens(
        consumeTrivia(options.trivia, spanStartOf(right), 'before', options),
        options,
        { skipLeadingWhitespace: true }
      );
    }
    const saved = options.suppressBoundaryTrivia;
    options.suppressBoundaryTrivia = 'pre';
    try {
      if (typeof right === 'string') {
        w.add(right, this);
      } else {
        right.writeSyntax(options);
      }
    } finally {
      options.suppressBoundaryTrivia = saved;
    }
  }

  override toTrimmedString(rawOptions?: PrintOptions): string {
    const options = getPrintOptions(rawOptions);
    const w = options.writer!;
    const position = w.position();
    this.writeSyntax(options);
    return w.getSince(position);
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
    if (typeof left === 'string' || typeof right === 'string') {
      return this;
    }
    const maybeLeft = left.eval(context);
    const finalize = (rawL: Node, rawR: Node): MaybePromise<OperationRenderResult> => {
      const l = recastNumericOperand(rawL);
      const r = recastNumericOperand(rawR);
      const renderOperands = (): OperationRenderResult => {
        return l === left && r === right
          ? this
          : { left: l, right: r };
      };
      if (Operation.isPreservedSlashList(l) || Operation.isPreservedSlashList(r)) {
        return renderOperands();
      }
      if (context.shouldOperate(op, l, r)) {
        if (isCalcCall(l) || isCalcCall(r)) {
          return this.createCalcFallback(
            Operation.unwrapCalcOperand(l),
            Operation.unwrapCalcOperand(r)
          );
        }
        if (Operation.isUnoperable(l) || Operation.isUnoperable(r)) {
          return renderOperands();
        }
        const unitMode = context?.options.unitMode ?? 'preserve';
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
    // bufferOrOptions is PrintOptions | undefined when not a RenderBuffer
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const printOptionsArg = bufferOrOptions as PrintOptions | undefined;
    const explicitWriter = renderBuffer ? undefined : printOptionsArg?.writer;
    const printOptions: PrintOptions | undefined = renderBuffer
      ? prepareBufferPrintState(context, options)
      : explicitWriter
        ? prepareBufferPrintState(context, printOptionsArg)
        : printOptionsArg;
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
    // A string operand is an already-final terminal (e.g. a `U+??????`
    // unicode-range segment). Math never applies — keep the operation as
    // authored so it serializes verbatim.
    if (typeof left === 'string' || typeof right === 'string') {
      return n;
    }
    const maybeLeft = left.eval(context);
    const finalize = (rawL: Node, rawR: Node): MaybePromise<Node> => {
      // The parser may deliver a numeric value terminal (`1px`) as a Keyword.
      // Recast numeric-text keyword operands to their operable value node so
      // math applies instead of throwing "Cannot operate on Keyword".
      const l = recastNumericOperand(rawL);
      const r = recastNumericOperand(rawR);
      if (Operation.isPreservedSlashList(l) || Operation.isPreservedSlashList(r)) {
        if (l === left && r === right) {
          return n;
        }
        return n.withOperands(l, r);
      }
      if (context.shouldOperate(op, l, r)) {
        // A preserved `calc(...)` operand must compose INTO a calc — nest and
        // flatten to a single `calc(l op r)`, not a bare operation with a calc
        // operand (which would stringify to an Any on the next operation).
        if (isCalcCall(l) || isCalcCall(r)) {
          return n.createCalcFallback(
            Operation.unwrapCalcOperand(l),
            Operation.unwrapCalcOperand(r)
          );
        }
        if (Operation.isUnoperable(l) || Operation.isUnoperable(r)) {
          // Preserve composite expressions such as `10px / 2 * 2` when a nested
          // operation intentionally remains unevaluated under current math mode,
          // or a surviving Paren operand like `(25vh - 20px)`.
          if (l === left && r === right) {
            return n;
          }
          return n.withOperands(l, r);
        }
        const unitMode = context?.options.unitMode ?? 'preserve';
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
