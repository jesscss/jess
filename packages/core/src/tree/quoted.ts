import { Interpolated } from './interpolated.js';
import { Any } from './any.js';
import { Node, F_STATIC, F_NON_STATIC, defineType, type NodeLocation, type TreeContext } from './node.js';
import type { Context } from '../context.js';
import { type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  writeRenderText,
  type RenderBuffer
} from './util/render-buffer.js';

export type QuotedOptions = {
  quote?: '"' | '\'';
  escaped?: boolean;
};

export interface Quoted extends Node<string | Any | Interpolated, QuotedOptions> {
  eval(context: Context): Promise<Quoted | Node>;
}

/**
 * A quoted string value. Called a `String` in CSS, but calling it Quoted
 * to avoid conflict with the built-in `String` class.
 */
export class Quoted extends Node<string | Any | Interpolated, QuotedOptions> {
  private withValue(value: string | Any | Interpolated): Quoted {
    return new Quoted(
      value,
      this._options ? { ...this._options } : undefined,
      this.location,
      this.sourceRoot?._treeContext
    ).inherit(this);
  }

  private renderQuotedSyntax(value = this.value, options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const quote = this._options?.quote ?? '"';
    const escaped = this._options?.escaped;
    let escapeChar = escaped ? '~' : '';
    if (escapeChar) {
      w.add(escapeChar, this);
    }
    w.add(quote);
    if (value instanceof Node) {
      value.toTrimmedString(options);
    } else {
      w.add(value, this);
    }
    w.add(quote);
    return w.getSince(mark);
  }

  constructor(value: string | Any | Interpolated, options?: QuotedOptions, location?: NodeLocation, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    if (typeof value === 'string' && !options?.escaped) {
      this.addFlag(F_STATIC);
    } else {
      this.addFlag(F_NON_STATIC);
    }
  }

  override toTrimmedString(options?: PrintOptions) {
    return this.renderQuotedSyntax(this.value, options);
  }

  override valueOf(): string {
    const { value } = this;
    return value instanceof Node ? value.valueOf() : value;
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const value = this.evaluateRenderValue(context);
    return isThenable(value)
      ? (value as Promise<string | Any | Interpolated | Node>).then(resolved => this.renderResolvedQuotedValue(context, resolved, bufferOrOptions, options))
      : this.renderResolvedQuotedValue(context, value as string | Any | Interpolated | Node, bufferOrOptions, options);
  }

  private renderResolvedQuotedValue(
    context: Context,
    value: string | Any | Interpolated | Node,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): MaybePromise<string> {
    if (this._options?.escaped) {
      if (value instanceof Node) {
        return this.renderOutput(context, value, bufferOrOptions, options);
      }
      const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
      return buffer
        ? writeRenderText(buffer, value)
        : value;
    }
    if (value instanceof Node && !(value instanceof Any) && !(value instanceof Interpolated)) {
      return this.renderOutput(context, value, bufferOrOptions, options);
    }
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareBufferPrintState(context, options)
      : prepareRenderPrintState(context, bufferOrOptions);
    const out = this.renderQuotedSyntax(value, prepared);
    return buffer
      ? writeRenderText(buffer, out)
      : out;
  }

  override compare(other: Node): 0 | 1 | -1 | undefined {
    if (other instanceof Quoted && !this._options?.escaped && !other._options?.escaped) {
      const left = String(this.valueOf());
      const right = String(other.valueOf?.() ?? '');
      if (left === right) {
        return 0;
      }
      return left > right ? 1 : -1;
    }
    return typeof other.toString === 'function' && this.toString() === other.toString() ? 0 : undefined;
  }

  private evaluateValue(context: Context): MaybePromise<Quoted | Node> {
    const cont = (value: string | Any | Interpolated | Node): Quoted | Node => {
      if (this._options?.escaped) {
        if (value instanceof Node) {
          return value;
        }
        return new Any(value);
      }
      if (value === this.value) {
        return this;
      }
      if (value instanceof Node && !(value instanceof Any) && !(value instanceof Interpolated)) {
        return value;
      }
      return this.withValue(value);
    };
    const { value } = this;
    if (value instanceof Node) {
      const out = value.eval(context);
      if (isThenable(out)) {
        return (out as Promise<Node | Any | Interpolated>).then(cont);
      }
      return cont(out as Node | Any | Interpolated);
    }
    return cont(value);
  }

  private evaluateRenderValue(context: Context): MaybePromise<string | Any | Interpolated | Node> {
    const { value } = this;
    if (!(value instanceof Node)) {
      return value;
    }
    return value.eval(context);
  }

  override evalNode(context: Context): MaybePromise<Quoted | Node> {
    return this.evaluateValue(context);
  }

  override resolve(context: Context): MaybePromise<Quoted | Node> {
    return this.evaluateValue(context);
  }
}
export const quoted = defineType(Quoted, 'Quoted');
