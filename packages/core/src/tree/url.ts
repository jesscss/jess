import { Node, F_STATIC, defineType } from './node.js';
import type { Context } from '../context.js';
import { type FinalPrintOptions, getPrintOptions, type PrintOptions } from './util/print.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { isRenderBuffer, prepareBufferPrintState, writeRenderText, type RenderBuffer } from './util/render-buffer.js';
import { prepareRenderPrintState } from './util/print.js';

/**
 * e.g. url('foo.png')
 */
export class Url extends Node<Node> {
  private withValue(value: Node): Url {
    return new Url(value).inherit(this);
  }

  private writeUrlSyntax(value: Node, options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('url(');
    if (options.context) {
      const valueMark = w.mark();
      value.toString(options);
      w.replaceSince(
        valueMark,
        value => value
          .replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, '')
          .replace(/\n[ \t\r\f]+/g, '\n  '),
        value
      );
    } else {
      value.toString(options);
    }
    w.add(')');
  }

  private renderUrlSyntax(value = this.value, options?: PrintOptions): string {
    options = getPrintOptions(options);
    const mark = options.writer.mark();
    this.writeUrlSyntax(value, options);
    const w = options.writer;
    return w.getSince(mark);
  }

  /**
   * @todo - enable URL rewriting
   */
  override valueOf(): string {
    const value = this.value;
    if (isNode(value, N.Quoted)) {
      const quotedValue = value.value;
      if (isNode(quotedValue)) {
        return String(quotedValue.value);
      }
      return quotedValue;
    }
    return String(value.valueOf());
  }

  override toTrimmedString(options?: PrintOptions) {
    return this.renderUrlSyntax(this.value, options);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    this.writeUrlSyntax(this.value, options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareBufferPrintState(context, options)
      : prepareRenderPrintState(context, bufferOrOptions);
    const value = this.hasFlag(F_STATIC) ? this.value : this.value.eval(context);
    if (isThenable(value)) {
      return (value as Promise<Node>).then((resolved) => {
        const out = this.renderUrlSyntax(resolved, prepared);
        return buffer
          ? writeRenderText(buffer, out)
          : out;
      });
    }
    const out = this.renderUrlSyntax(value as Node, prepared);
    return buffer
      ? writeRenderText(buffer, out)
      : out;
  }

  override evalNode(context: Context): MaybePromise<Node> {
    return this.evaluateValue(context);
  }

  private evaluateValue(context: Context): MaybePromise<Node> {
    if (this.hasFlag(F_STATIC)) {
      return this;
    }
    const value = this.value.eval(context);
    const finalize = (resolvedValue: Node): Node => {
      if (resolvedValue === this.value) {
        return this;
      }
      return this.withValue(resolvedValue);
    };
    if (isThenable(value)) {
      return (value as Promise<Node>).then(finalize);
    }
    return finalize(value as Node);
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evaluateValue(context);
  }
}

export const url = defineType(Url, 'Url');
