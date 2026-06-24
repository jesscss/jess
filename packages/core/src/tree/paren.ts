import { type Context } from '../context.js';
import { Any } from './any.js';
import { Bool, createPublicBool } from './bool.js';
import { Expression } from './expression.js';
import { Operation } from './operation.js';
import { Node, defineType, F_MAY_ASYNC, F_NON_STATIC, type NodeLocation } from './node.js';
import { Dimension } from './dimension.js';
import { List, renderListValueSyntax } from './list.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import { consumeTrivia, emitTriviaTokens } from './util/trivia.js';
import {
  isRenderBuffer,
  prepareBufferPrintState,
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

function writeParenValue(value: Node, options: FinalPrintOptions): void {
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
  static override childKeys = ['value'] as const;

  declare readonly value: Node | undefined;

  private getDelimiters(): [open: string, close: string] {
    return this._options?.delimiter === 'square' ? ['[', ']'] : ['(', ')'];
  }

  private simpleWrappedText(value: Node | undefined): string | undefined {
    const escapeChar = this._options?.escaped ? '~' : '';
    const [open, close] = this.getDelimiters();
    if (!value || !value.visible) {
      return `${escapeChar}${open}${close}`;
    }
    if (value instanceof Any) {
      return `${escapeChar}${open}${value.value}${close}`;
    }
    return undefined;
  }

  private writeSimpleWrappedSyntax(value: Node | undefined, options: FinalPrintOptions): string | undefined {
    const text = this.simpleWrappedText(value);
    if (text === undefined) {
      return undefined;
    }
    const w = options.writer;
    const escapeChar = this._options?.escaped ? '~' : '';
    const [open, close] = this.getDelimiters();
    if (escapeChar) {
      w.add(escapeChar, this);
    }
    w.add(open, this);
    if (value instanceof Any) {
      w.add(value.value, value);
    }
    w.add(close, this);
    return text;
  }

  private withValue(value: Node | undefined): Paren {
    return new Paren(
      value,
      this._options ? { ...this._options } : undefined,
      this.location,
      this.sourceRoot?._treeContext
    ).inherit(this);
  }

  constructor(
    value?: Node,
    options?: ParenOptions,
    location?: NodeLocation,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    this._treeContext = treeContext;
    if (options?.escaped) {
      this.addFlag(F_NON_STATIC);
    }
  }

  override toTrimmedString(options?: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    if (!printOptions.trivia) {
      const simple = this.writeSimpleWrappedSyntax(this.value, printOptions);
      if (simple !== undefined) {
        return simple;
      }
    }
    const w = printOptions.writer;
    const mark = w.mark();
    this.writeSyntax(printOptions);
    return w.getSince(mark);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    if (!options.trivia && this.writeSimpleWrappedSyntax(this.value, options) !== undefined) {
      return;
    }
    const w = options.writer;
    const escapeChar = this._options?.escaped ? '~' : '';
    if (escapeChar) {
      w.add(escapeChar, this);
    }
    const [open, close] = this.getDelimiters();
    w.add(open);
    const value = this.value;
    if (value) {
      writeParenValue(value, options);
    }
    w.add(close);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const guardValue = getDefaultGuardValue(this.value, context);
    if (guardValue !== undefined) {
      const out = String(guardValue);
      return isRenderBuffer(bufferOrOptions)
        ? writeRenderText(bufferOrOptions, out)
        : out;
    }
    return this.renderResolvedValue(context, bufferOrOptions, options);
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
        const evaluated = currentValue.eval(context);
        if (!(evaluated instanceof Node)) {
          throw new TypeError('Expected paren value to evaluate to a node');
        }
        return finish(evaluated);
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
      return finish(maybeEvald as Node);
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
      return this.renderWrappedValue(context, value, bufferOrOptions, options);
    }
    while (value instanceof Paren && value.value) {
      value = value.value;
    }
    if (value instanceof Bool || value instanceof Dimension) {
      return this.renderOutput(context, value, bufferOrOptions, options);
    }
    if (isOp && !isOpOrExpression(value)) {
      return this.renderWrappedValue(context, value, bufferOrOptions, options);
    }
    if (value === currentValue) {
      return this.renderOutput(context, this, bufferOrOptions, options);
    }
    return this.renderWrappedValue(context, value, bufferOrOptions, options);
  }

  private renderWrappedValue(
    context: Context,
    value: Node,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): MaybePromise<string> {
    const simple = this.simpleWrappedText(value);
    if (simple !== undefined) {
      if (isRenderBuffer(bufferOrOptions)) {
        return writeRenderText(bufferOrOptions, simple);
      }
      const prepared = prepareRenderPrintState(context, bufferOrOptions);
      this.writeSimpleWrappedSyntax(value, prepared);
      return simple;
    }
    const escapeChar = this._options?.escaped ? '~' : '';
    const [open, close] = this.getDelimiters();
    const prefix = `${escapeChar}${open}`;
    if (isRenderBuffer(bufferOrOptions)) {
      writeRenderText(bufferOrOptions, prefix);
      const rendered = value.render(context, bufferOrOptions, options);
      const finish = (out: string): string => {
        writeRenderText(bufferOrOptions, close);
        return `${prefix}${out}${close}`;
      };
      return isThenable(rendered)
        ? (rendered as Promise<string>).then(finish)
        : finish(rendered);
    }
    const prepared = prepareRenderPrintState(context, bufferOrOptions);
    const w = prepared.writer;
    if (escapeChar) {
      w.add(escapeChar, this);
    }
    w.add(open, this);
    const rendered = value.render(context, prepared);
    const finish = (out: string): string => {
      w.add(close, this);
      return `${prefix}${out}${close}`;
    };
    return isThenable(rendered)
      ? (rendered as Promise<string>).then(finish)
      : finish(rendered);
  }

  private renderEscapedSemicolonList(
    context: Context,
    value: List,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareBufferPrintState(context, options)
      : prepareRenderPrintState(context, isRenderBuffer(bufferOrOptions) ? undefined : bufferOrOptions);
    const out = renderListValueSyntax(value.value, prepared, ',');
    return buffer
      ? writeRenderText(buffer, out)
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
        if (this._options?.escaped) {
          if (value instanceof List && value.options?.sep === ';') {
            return new Any(renderListValueSyntax(value.value, {}, ','));
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
        return (maybeEvald as Promise<Node>).then(after);
      }
      return after(maybeEvald as Node);
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
