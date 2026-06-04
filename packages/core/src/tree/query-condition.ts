import type { Context } from '../context.js';
import { getPrintOptions, prepareRenderPrintState, type PrintOptions } from './util/print.js';
import { defineType, F_STATIC, type Node } from './node.js';
import { Sequence } from './sequence.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
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
  private renderQueryConditionSyntax(value: Node[], options?: PrintOptions, context?: Context): string | MaybePromise<string> {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const length = value.length;

    if (length === 0) {
      return '';
    }

    const emitTrimmed = (node: Node): MaybePromise<string | void> => {
      const saved = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      const before = w.mark();
      let asyncOut = false;
      try {
        const out = context
          ? node.render(context, options)
          : node.toString(options);
        if (isThenable(out)) {
          asyncOut = true;
          return out.then(
            (rendered) => {
              if (w.mark() === before) {
                w.add(rendered);
              }
              options.suppressBoundaryTrivia = saved;
              return rendered;
            },
            (error) => {
              options.suppressBoundaryTrivia = saved;
              throw error;
            }
          );
        }
        if (typeof out === 'string' && w.mark() === before) {
          w.add(out);
        }
        options.suppressBoundaryTrivia = saved;
        return out;
      } finally {
        if (!asyncOut) {
          options.suppressBoundaryTrivia = saved;
        }
      }
    };

    for (let i = 0; i < length; i++) {
      if (i > 0) {
        w.add(' ');
      }
      const rendered = emitTrimmed(value[i]!);
      if (isThenable(rendered)) {
        return (rendered as Promise<string | void>).then(() => renderRest(i + 1));
      }
    }

    return w.getSince(mark);

    async function renderRest(start: number): Promise<string> {
      for (let i = start; i < length; i++) {
        if (i > 0) {
          w.add(' ');
        }
        await emitTrimmed(value[i]!);
      }
      return w.getSince(mark);
    }
  }

  override toTrimmedString(options?: PrintOptions): string {
    return this.renderQueryConditionSyntax(this.value, options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const printOptions = buffer ? options : bufferOrOptions;
    const prepared = buffer
      ? prepareBufferPrintState(context, options)
      : prepareRenderPrintState(context, printOptions);
    const rendered = this.hasFlag(F_STATIC)
      ? this.renderQueryConditionSyntax(this.value, prepared)
      : this.renderQueryConditionSyntax(this.value, prepared, context);
    if (isThenable(rendered)) {
      return buffer
        ? (rendered as Promise<string>).then(out => writeRenderText(buffer, out))
        : rendered;
    }
    return buffer
      ? writeRenderText(buffer, rendered as string)
      : rendered as string;
  }
}
export const query = defineType(QueryCondition, 'QueryCondition', 'query');
