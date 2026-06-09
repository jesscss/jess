import type { Context } from '../context.js';
import { type FinalPrintOptions, getPrintOptions, prepareRenderPrintState, type PrintOptions } from './util/print.js';
import { defineType, F_MAY_ASYNC, F_STATIC, type Node } from './node.js';
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
  private writeQueryConditionSyntax(value: Node[], options: FinalPrintOptions): void {
    const w = options.writer;
    const length = value.length;

    if (length === 0) {
      return;
    }

    for (let i = 0; i < length; i++) {
      if (i > 0) {
        w.add(' ');
      }
      const saved = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      try {
        value[i]!.toString(options);
      } finally {
        options.suppressBoundaryTrivia = saved;
      }
    }
  }

  private renderQueryConditionSyntax(value: Node[], options?: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    const mark = printOptions.writer.mark();
    this.writeQueryConditionSyntax(value, printOptions);
    const w = printOptions.writer;
    return w.getSince(mark);
  }

  private renderQueryConditionValue(value: Node[], options: FinalPrintOptions, context: Context): MaybePromise<string> {
    const w = options.writer;
    const mark = w.mark();
    const length = value.length;

    if (length === 0) {
      return '';
    }

    const emitRendered = (node: Node): MaybePromise<void> => {
      const saved = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      let asyncOut = false;
      try {
        if (node.hasFlag(F_STATIC) && !this.hasFlag(F_MAY_ASYNC)) {
          node.toString(options);
          return;
        }
        const before = w.mark();
        const rendered = node.render(context, options);
        if (isThenable(rendered)) {
          asyncOut = true;
          return (rendered as Promise<string>).then(
            (out) => {
              if (w.mark() === before) {
                w.add(out);
              }
              options.suppressBoundaryTrivia = saved;
            },
            (error) => {
              options.suppressBoundaryTrivia = saved;
              throw error;
            }
          );
        }
        if (w.mark() === before) {
          w.add(rendered as string);
        }
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
      const rendered = emitRendered(value[i]!);
      if (isThenable(rendered)) {
        return (rendered as Promise<void>).then(() => renderRest(i + 1));
      }
    }

    return w.getSince(mark);

    async function renderRest(start: number): Promise<string> {
      for (let i = start; i < length; i++) {
        if (i > 0) {
          w.add(' ');
        }
        await emitRendered(value[i]!);
      }
      return w.getSince(mark);
    }
  }

  override toTrimmedString(options?: PrintOptions): string {
    return this.renderQueryConditionSyntax(this.value, options);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    this.writeQueryConditionSyntax(this.value, options);
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
      : this.renderQueryConditionValue(this.value, prepared, context);
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
