import { type Context } from '../context.js';
import { Any } from './any.js';
import { Bool, createPublicBool } from './bool.js';
import { Expression } from './expression.js';
import { Operation } from './operation.js';
import { Node, defineType, F_MAY_ASYNC, F_NON_STATIC, type NodeLocation } from './node.js';
import { Dimension } from './dimension.js';
import { List, renderListValueSyntax } from './list.js';
import { Nil } from './nil.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import { consumeTrivia, emitTriviaTokens } from './util/trivia.js';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  writePreparedRenderText,
  writeRenderText,
  type RenderBuffer
} from './util/render-buffer.js';
import { getDefaultGuardValue } from './util/default-guard.js';
// import type { Context } from '../context.js'
// import type { OutputCollector } from '../output'

export type ParenOptions = {
  escaped?: boolean;
  delimiter?: 'paren' | 'square';
};

const isOpOrExpression = (node: Node): node is Operation | Expression => {
  return node instanceof Operation || node instanceof Expression;
};

const getDefaultGuardBool = (node: Node | undefined, context: Context): Bool | undefined => {
  const value = getDefaultGuardValue(node, context);
  return value === undefined ? undefined : createPublicBool(value);
};

function normalizeEscapedList(value: List): List {
  return new List([...value.value], { ...value.options, sep: ',' }).inherit(value);
}

function emitParenValue(value: Node, options: ReturnType<typeof getPrintOptions>): void {
  if (options.trivia) {
    emitTriviaTokens(
      consumeTrivia(options.trivia, value.location[0], 'before', options),
      options,
      { skipLeadingWhitespace: true }
    );
  }
  const saved = options.suppressBoundaryTrivia;
  options.suppressBoundaryTrivia = 'pre';
  try {
    value.writeSyntax(options);
  } finally {
    options.suppressBoundaryTrivia = saved;
  }
}

/**
 * An expression in parenthesis
 */
export class Paren extends Node<Node | undefined, ParenOptions> {
  private withValue(value: Node | undefined): Paren {
    return new Paren(
      value,
      this._options ? { ...this._options } : undefined,
      this.location
    ).inherit(this);
  }

  constructor(value?: Node, options?: ParenOptions, location?: NodeLocation) {
    super(value, options, location);
    if (options?.escaped) {
      this.addFlag(F_NON_STATIC);
    }
  }

  /** @internal */
  override writeSyntax(printOptions: FinalPrintOptions): void {
    const w = printOptions.writer;
    const escapeChar = this._options?.escaped ? '~' : '';
    if (escapeChar) {
      w.add(escapeChar, this);
    }
    const open = this._options?.delimiter === 'square' ? '[' : '(';
    const close = this._options?.delimiter === 'square' ? ']' : ')';
    w.add(open);
    let value = this.value;
    if (value) {
      if (value instanceof Node) {
        emitParenValue(value, printOptions);
      } else {
        w.add(String(value), this);
      }
    }
    w.add(close);
  }

  override toTrimmedString(options?: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    const out = this.emptyParenText(printOptions);
    if (out !== undefined) {
      printOptions.writer.add(out, this);
      return out;
    }
    const value = this.value;
    if (value instanceof Any) {
      const scalar = this.directAnySourceText(value, printOptions);
      if (scalar !== undefined) {
        this.writeDirectAnySourceText(value, printOptions);
        return scalar;
      }
    }
    const mark = printOptions.writer.mark();
    this.writeSyntax(printOptions);
    const w = printOptions.writer;
    return w.getSince(mark);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const emptyText = this.emptyParenText(buffer ? options : bufferOrOptions);
    if (emptyText !== undefined) {
      if (buffer) {
        return writeRenderText(buffer, emptyText);
      }
      getPrintOptions(bufferOrOptions).writer.add(emptyText, this);
      return emptyText;
    }
    const guardValue = getDefaultGuardValue(this.value, context);
    if (guardValue !== undefined) {
      const out = String(guardValue);
      return isRenderBuffer(bufferOrOptions)
        ? writeRenderText(bufferOrOptions, out)
        : out;
    }
    const directValue = this.value;
    if (!this._options?.escaped && directValue instanceof Any) {
      const scalar = this.directAnySourceText(directValue, buffer ? options : bufferOrOptions);
      if (scalar !== undefined) {
        if (buffer) {
          return writeRenderText(buffer, scalar);
        }
        const printOptions = getPrintOptions(bufferOrOptions);
        this.writeDirectAnySourceText(directValue, printOptions);
        return scalar;
      }
    }
    return this.renderResolvedValue(context, bufferOrOptions, options);
  }

  private emptyParenText(options?: PrintOptions): string | undefined {
    if (this.value && (!(this.value instanceof Nil) || options?.trivia)) {
      return undefined;
    }
    const escapeChar = this._options?.escaped ? '~' : '';
    return this._options?.delimiter === 'square'
      ? `${escapeChar}[]`
      : `${escapeChar}()`;
  }

  private directAnySourceText(value: Any, options?: PrintOptions): string | undefined {
    if (options?.trivia) {
      return undefined;
    }
    const escapeChar = this._options?.escaped ? '~' : '';
    const open = this._options?.delimiter === 'square' ? '[' : '(';
    const close = this._options?.delimiter === 'square' ? ']' : ')';
    return escapeChar + open + value.value + close;
  }

  private writeDirectAnySourceText(value: Any, options: FinalPrintOptions): void {
    const w = options.writer;
    const escapeChar = this._options?.escaped ? '~' : '';
    if (escapeChar) {
      w.add(escapeChar, this);
    }
    w.add(this._options?.delimiter === 'square' ? '[' : '(');
    w.add(value.value, value);
    w.add(this._options?.delimiter === 'square' ? ']' : ')');
  }

  private renderResolvedValue(
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): MaybePromise<string> {
    const currentValue = this.value;
    if (!currentValue) {
      return this.renderOutput(context, this, bufferOrOptions, options);
    }
    const guardBool = getDefaultGuardBool(currentValue, context);
    if (guardBool) {
      return this.renderOutput(context, guardBool, bufferOrOptions, options);
    }
    const isOp = isOpOrExpression(currentValue);
    if (isOp) {
      context.parenFrames.push(true);
    }
    const finish = (resolved: Node): MaybePromise<string> => {
      if (isOp) {
        context.parenFrames.pop();
      }
      return this.renderEvaluatedNode(context, currentValue, isOp, resolved, bufferOrOptions, options);
    };
    try {
      if (!currentValue.hasFlag(F_MAY_ASYNC)) {
        return finish(currentValue.evalImmediateSync(context));
      }
      const maybeEvald = currentValue.eval(context);
      if (isThenable(maybeEvald)) {
        return maybeEvald.then(
          finish,
          (error) => {
            if (isOp) {
              context.parenFrames.pop();
            }
            throw error;
          }
        );
      }
      return finish(maybeEvald);
    } catch (error) {
      if (isOp) {
        context.parenFrames.pop();
      }
      throw error;
    }
  }

  private renderEvaluatedNode(
    context: Context,
    currentValue: Node,
    isOp: boolean,
    resolved: Node,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): MaybePromise<string> {
    let value = resolved;
    const evaluatedGuardBool = getDefaultGuardBool(value, context);
    if (evaluatedGuardBool) {
      return this.renderOutput(context, evaluatedGuardBool, bufferOrOptions, options);
    }
    if (this._options?.escaped) {
      if (value instanceof List && value.options?.sep === ';') {
        return this.renderEscapedSemicolonList(context, value, bufferOrOptions, options);
      }
      return this.renderOutput(context, value, bufferOrOptions, options);
    }
    if (value instanceof Any) {
      const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
      const scalar = this.directAnySourceText(value, buffer ? options : bufferOrOptions);
      if (scalar !== undefined) {
        if (buffer) {
          return writeRenderText(buffer, scalar);
        }
        this.writeDirectAnySourceText(value, getPrintOptions(bufferOrOptions));
        return scalar;
      }
    }
    while (value instanceof Paren && value.value) {
      value = value.value;
    }
    if (value instanceof Bool || value instanceof Dimension) {
      return this.renderOutput(context, value, bufferOrOptions, options);
    }
    if (isOp && !isOpOrExpression(value)) {
      return this.renderOutput(context, value, bufferOrOptions, options);
    }
    if (value === currentValue) {
      return this.renderOutput(context, this, bufferOrOptions, options);
    }
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const renderOptions = buffer
      ? options?.writer ? undefined : options
      : bufferOrOptions?.writer ? undefined : bufferOrOptions;
    const rendered = value.render(context, renderOptions);
    const open = this._options?.delimiter === 'square' ? '[' : '(';
    const close = this._options?.delimiter === 'square' ? ']' : ')';
    const wrapped = isThenable(rendered)
      ? rendered.then(out => `${open}${out}${close}`)
      : `${open}${rendered}${close}`;
    if (!buffer) {
      if (isThenable(wrapped)) {
        return wrapped.then((out) => {
          bufferOrOptions?.writer?.add(out, this);
          return out;
        });
      }
      bufferOrOptions?.writer?.add(wrapped, this);
      return wrapped;
    }
    return isThenable(wrapped)
      ? wrapped.then(out => writeRenderText(buffer, out))
      : writeRenderText(buffer, wrapped);
  }

  private renderEscapedSemicolonList(
    context: Context,
    value: List,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareBufferPrintState(context, options, buffer)
      : prepareRenderPrintState(context, bufferOrOptions);
    const mark = buffer ? prepared.writer.mark() : 0;
    const out = renderListValueSyntax(value.value, prepared, ',');
    return buffer
      ? writePreparedRenderText(buffer, prepared, mark, out)
      : out;
  }

  private evaluateValue(context: Context): MaybePromise<Node> {
    const currentValue = this.value;
    if (currentValue) {
      const guardBool = getDefaultGuardBool(currentValue, context);
      if (guardBool) {
        return guardBool;
      }
      const isOp = isOpOrExpression(currentValue);
      if (isOp) {
        context.parenFrames.push(true);
      }
      const maybeEvald = currentValue.eval(context);
      const after = (v: Node): Node => {
        let value = v;
        if (isOp) {
          context.parenFrames.pop();
        }
        const evaluatedGuardBool = getDefaultGuardBool(value, context);
        if (evaluatedGuardBool) {
          return evaluatedGuardBool;
        }
        if (this._options?.escaped && value instanceof Node) {
          if (value instanceof List && value.options?.sep === ';') {
            return normalizeEscapedList(value);
          }
          return value;
        }
        /**
         * Removing nested parens or parens around a single
         * dimension is a bit presumptuous, but I think Less's
         * argument is that it's unnecessary at runtime,
         * so it's really just a DX tool that can be ignored
         * on output.
         */
        while (value instanceof Paren && value.value) {
          value = value.value;
        }
        if (value instanceof Bool || value instanceof Dimension) {
          return value;
        }
        if (isOp && !isOpOrExpression(value)) {
          return value;
        }
        if (value === currentValue) {
          return this;
        }
        return this.withValue(value);
      };
      if (isThenable(maybeEvald)) {
        return maybeEvald.then(after);
      }
      return after(maybeEvald);
    }
    return this;
  }

  override evalNode(context: Context): MaybePromise<Node> {
    return this.evaluateValue(context);
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evaluateValue(context);
  }

  // toCSS(context: Context, out: OutputCollector) {
  //   out.add('(')
  //   this.value.toCSS(context, out)
  //   out.add(')')
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const loc = this.location
  //   out.add('$J.paren(', loc)
  //   this.value.toModule(context, out)
  //   out.add(')')
  // }
}

export const paren = defineType(Paren, 'Paren');
