import { defineType, Node } from './node.js';
import type { Context } from '../context.js';
import { isNode } from './util/is-node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import {
  isRenderBuffer,
  renderNodeToBuffer,
  type RenderBuffer
} from './util/render-buffer.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';

/**
 * A rest expression (e.g. ...$var). By itself it doesn't do much.
 * It's used by lists to merge values. Sequences already bubble
 * lists / sequences, so this is mostly for serialization.
 */
export class Rest extends Node<Node | string | undefined> {
  get name(): string {
    let { value } = this;
    if (value) {
      if (isNode(value)) {
        return value.toString();
      }
      return `$${value}`;
    }
    return '';
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('...$');
    w.add(this.name);
    return w.getSince(mark);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      return renderNodeToBuffer(this, context, bufferOrOptions, options);
    }
    return this.toTrimmedString(getPrintOptions({ ...bufferOrOptions, context }));
  }

  override resolve(_context: Context): this {
    return this;
  }
}

export const rest = defineType(Rest, 'Rest');
