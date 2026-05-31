import type { Context } from '../context.js';
import { getPrintOptions, prepareRenderPrintState, type PrintOptions } from './util/print.js';
import { defineType, type Node } from './node.js';
import { Sequence } from './sequence.js';
import { isThenable, serialForEach, type MaybePromise } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  type RenderBuffer,
  writeRenderText
} from './util/render-buffer.js';

/**
 * Used by `@media`, `@supports`, and `@container`
 *
 * This just helps identify conditions if we need to
 * merge them later.
 *
 * @todo - add more structure?
 */
export class QueryCondition extends Sequence {
  private resolveItems(context: Context): MaybePromise<Node[]> {
    const values: Node[] = [];
    const maybe = serialForEach(this.value.map((item, index) => [item, index] as const), ([item, index]) => {
      const out = item.resolve(context);
      if (isThenable(out)) {
        return (out as Promise<Node>).then((resolved) => {
          values[index] = resolved;
        });
      }
      values[index] = out as Node;
    });
    if (isThenable(maybe)) {
      return (maybe as Promise<void>).then(() => values);
    }
    return values;
  }

  private renderQueryConditionSyntax(value: Node[], options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const length = value.length;

    if (length === 0) {
      return '';
    }

    const emitTrimmed = (node: Node) => {
      const saved = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      try {
        node.toString(options);
      } finally {
        options.suppressBoundaryTrivia = saved;
      }
    };

    emitTrimmed(value[0]!);

    // Space out sub-nodes
    for (let i = 1; i < length; i++) {
      const node = value[i]!;
      w.add(' ');
      emitTrimmed(node);
    }
    return w.getSince(mark);
  }

  override toTrimmedString(options?: PrintOptions): string {
    return this.renderQueryConditionSyntax(this.value, options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const printOptions = buffer ? options : bufferOrOptions;
    const resolved = this.resolveItems(context);
    const write = (value: Node[]): string => {
      const prepared = buffer
        ? prepareBufferPrintState(context, options)
        : prepareRenderPrintState(context, printOptions);
      const out = this.renderQueryConditionSyntax(value, prepared);
      return buffer
        ? writeRenderText(buffer, out)
        : out;
    };
    if (isThenable(resolved)) {
      return (resolved as Promise<Node[]>).then(write);
    }
    return write(resolved as Node[]);
  }
}
export const query = defineType(QueryCondition, 'QueryCondition', 'query');
