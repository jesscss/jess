import { type Context } from '../context.js';
import { Bool } from './bool.js';
import { Expression } from './expression.js';
import { Operation } from './operation.js';
import { Node, defineType, F_NON_STATIC, type NodeLocation, type TreeContext } from './node.js';
import { Dimension } from './dimension.js';
import { List } from './list.js';
import { type MaybePromise, isThenable, pipe } from '@jesscss/awaitable-pipe';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { consumeTrivia, emitTriviaTokens } from './util/trivia.js';
import {
  isRenderBuffer,
  writeRenderText,
  writeRenderTextResult,
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
  return value === undefined ? undefined : new Bool(value);
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
    value.toString(options);
  } finally {
    options.suppressBoundaryTrivia = saved;
  }
}

type ParenRenderValue = {
  node: Node;
  wrap: boolean;
};

/**
 * An expression in parenthesis
 */
export class Paren extends Node<Node | undefined, ParenOptions> {
  private withValue(value: Node | undefined): Paren {
    return new Paren(
      value,
      this._options ? { ...this._options } : undefined,
      this.location,
      this.treeContext
    ).inherit(this);
  }

  constructor(value?: Node, options?: ParenOptions, location?: NodeLocation, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    if (options?.escaped) {
      this.addFlag(F_NON_STATIC);
    }
  }

  override toTrimmedString(options?: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    const w = printOptions.writer;
    const mark = w.mark();
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
    return w.getSince(mark);
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
    return pipe(
      () => this.evaluateRenderValue(context),
      value => this.renderEvaluatedValue(context, value, bufferOrOptions, options)
    );
  }

  private evaluateRenderValue(context: Context): MaybePromise<ParenRenderValue> {
    const currentValue = this.value;
    if (!currentValue) {
      return { node: this, wrap: false };
    }
    const guardBool = getDefaultGuardBool(currentValue, context);
    if (guardBool) {
      return { node: guardBool, wrap: false };
    }
    const isOp = isOpOrExpression(currentValue);
    if (isOp) {
      context.parenFrames.push(true);
    }
    const maybeEvald = currentValue.resolve(context);
    const after = (v: Node): ParenRenderValue => {
      let value = v;
      if (isOp) {
        context.parenFrames.pop();
      }
      const evaluatedGuardBool = getDefaultGuardBool(value, context);
      if (evaluatedGuardBool) {
        return { node: evaluatedGuardBool, wrap: false };
      }
      if (this._options?.escaped) {
        if (value instanceof List && value.options?.sep === ';') {
          return { node: normalizeEscapedList(value), wrap: false };
        }
        return { node: value, wrap: false };
      }
      while (value instanceof Paren && value.value) {
        value = value.value;
      }
      if (value instanceof Bool || value instanceof Dimension) {
        return { node: value, wrap: false };
      }
      if (isOp && !isOpOrExpression(value)) {
        return { node: value, wrap: false };
      }
      if (value === currentValue) {
        return { node: this, wrap: false };
      }
      return { node: value, wrap: true };
    };
    if (isThenable(maybeEvald)) {
      return (maybeEvald as Promise<Node>).then(after);
    }
    return after(maybeEvald as Node);
  }

  private renderEvaluatedValue(
    context: Context,
    value: ParenRenderValue,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): MaybePromise<string> {
    if (value.node === this || !value.wrap) {
      return this.renderOutput(context, value.node, bufferOrOptions, options);
    }
    const rendered = value.node.render(context, isRenderBuffer(bufferOrOptions) ? options : bufferOrOptions);
    const wrapped = pipe(
      () => rendered,
      (out) => {
        const open = this._options?.delimiter === 'square' ? '[' : '(';
        const close = this._options?.delimiter === 'square' ? ']' : ')';
        return `${open}${out}${close}`;
      }
    );
    return isRenderBuffer(bufferOrOptions)
      ? writeRenderTextResult(bufferOrOptions, wrapped)
      : wrapped;
  }

  private evaluateValue(context: Context, mode: 'eval' | 'resolve'): MaybePromise<Node> {
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
      const maybeEvald = mode === 'eval' ? currentValue.eval(context) : currentValue.resolve(context);
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
        return (maybeEvald as Promise<Node>).then(after);
      }
      return after(maybeEvald as Node);
    }
    return this;
  }

  override evalNode(context: Context): MaybePromise<Node> {
    return this.evaluateValue(context, 'eval');
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evaluateValue(context, 'resolve');
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
