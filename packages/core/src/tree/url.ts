import { Node, defineType } from './node.js';
import type { Context } from '../context.js';
import { getPrintOptions, type PrintOptions } from './util/print.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  renderNodeToBuffer,
  type RenderBuffer
} from './util/render-buffer.js';

/**
 * e.g. url('foo.png')
 */
export class Url extends Node<Node> {
  private withValue(value: Node): Url {
    return new Url(value).inherit(this);
  }

  private renderUrlSyntax(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('url(');
    if (options.context) {
      const valueMark = w.mark();
      this.value.toString(options);
      w.replaceSince(
        valueMark,
        value => value
          .replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, '')
          .replace(/\n[ \t\r\f]+/g, '\n  '),
        this.value
      );
    } else {
      this.value.toString(options);
    }
    w.add(')');
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
    return this.renderUrlSyntax(options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      return renderNodeToBuffer(this, context, bufferOrOptions, options);
    }
    return super.render(context, bufferOrOptions);
  }

  override resolve(context: Context): MaybePromise<Node> {
    const value = this.value.resolve(context);
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
}

export const url = defineType(Url, 'Url');
