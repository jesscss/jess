import { Node, F_MAY_ASYNC, F_STATIC, defineType } from './node.js';
import type { Context } from '../context.js';
import { type FinalPrintOptions, getPrintOptions, type PrintOptions } from './util/print.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { isRenderBuffer, prepareBufferPrintState, writePreparedRenderText, type RenderBuffer } from './util/render-buffer.js';
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
      const trivia = options.trivia ?? value.sourceRoot?._treeContext?.opts?.trivia;
      if (trivia) {
        value.toString(options);
      } else {
        value.writeSyntax(options);
      }
      w.replaceSince(
        valueMark,
        value => value
          .replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, '')
          .replace(/\n[ \t\r\f]+/g, '\n  '),
        value
      );
    } else {
      value.writeSyntax(options);
    }
    w.add(')');
  }

  private renderUrlSyntax(value = this.value, options?: PrintOptions): string {
    options = getPrintOptions(options);
    if (!options.context && isNode(value, N.Any) && typeof value.value === 'string') {
      const out = `url(${value.value})`;
      options.writer.add(out, this);
      return out;
    }
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
      ? prepareBufferPrintState(context, options, buffer)
      : prepareRenderPrintState(context, bufferOrOptions);
    const mark = buffer ? prepared.writer.mark() : 0;
    const value = this.hasFlag(F_STATIC)
      ? this.value
      : this.value.hasFlag(F_MAY_ASYNC)
        ? this.value.eval(context)
        : this.value.evalSync(context);
    if (isThenable(value)) {
      return value.then((resolved) => {
        const out = this.renderUrlSyntax(resolved, prepared);
        return buffer
          ? writePreparedRenderText(buffer, prepared, mark, out)
          : out;
      });
    }
    const out = this.renderUrlSyntax(value, prepared);
    return buffer
      ? writePreparedRenderText(buffer, prepared, mark, out)
      : out;
  }

  override evalNode(context: Context): MaybePromise<Node> {
    return this.evaluateValue(context);
  }

  private evaluateValue(context: Context): MaybePromise<Node> {
    if (this.hasFlag(F_STATIC)) {
      return this;
    }
    const value = this.value.hasFlag(F_MAY_ASYNC)
      ? this.value.eval(context)
      : this.value.evalSync(context);
    const finalize = (resolvedValue: Node): Node => {
      if (resolvedValue === this.value) {
        return this;
      }
      return this.withValue(resolvedValue);
    };
    if (isThenable(value)) {
      return value.then(finalize);
    }
    return finalize(value);
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evaluateValue(context);
  }
}

export const url = defineType(Url, 'Url');
