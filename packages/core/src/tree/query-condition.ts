import type { Context } from '../context.js';
import { type FinalPrintOptions, getPrintOptions, prepareRenderPrintState, type PrintOptions } from './util/print.js';
import { defineType, F_MAY_ASYNC, F_STATIC, type Node } from './node.js';
import { Sequence } from './sequence.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  type RenderBuffer,
  writePreparedRenderTextResult,
  writePreparedRenderText
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
        value[i]!.writeSyntax(options);
      } finally {
        options.suppressBoundaryTrivia = saved;
      }
    }
  }

  private renderQueryConditionSyntax(value: Node[], options?: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    if (value.length === 0) {
      return '';
    }
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

    for (let i = 0; i < length; i++) {
      if (i > 0) {
        w.add(' ');
      }
      const node = value[i]!;
      const saved = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      let asyncOut = false;
      try {
        if (node.hasFlag(F_STATIC) && !this.hasFlag(F_MAY_ASYNC)) {
          node.writeSyntax(options);
        } else {
          const before = w.mark();
          const rendered = node.render(context, options);
          if (isThenable(rendered)) {
            asyncOut = true;
            return rendered.then(
              (out) => {
                if (w.mark() === before) {
                  w.add(out);
                }
                options.suppressBoundaryTrivia = saved;
                return this.renderQueryConditionValueRest(value, options, context, mark, i + 1);
              },
              (error) => {
                options.suppressBoundaryTrivia = saved;
                throw error;
              }
            );
          }
          if (w.mark() === before) {
            w.add(rendered);
          }
        }
      } finally {
        if (!asyncOut) {
          options.suppressBoundaryTrivia = saved;
        }
      }
    }

    return w.getSince(mark);
  }

  private async renderQueryConditionValueRest(
    value: Node[],
    options: FinalPrintOptions,
    context: Context,
    mark: number,
    start: number
  ): Promise<string> {
    const w = options.writer;
    for (let i = start; i < value.length; i++) {
      if (i > 0) {
        w.add(' ');
      }
      const node = value[i]!;
      const saved = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      try {
        if (node.hasFlag(F_STATIC) && !this.hasFlag(F_MAY_ASYNC)) {
          node.writeSyntax(options);
          continue;
        }
        const before = w.mark();
        const rendered = await node.render(context, options);
        if (w.mark() === before) {
          w.add(rendered);
        }
      } finally {
        options.suppressBoundaryTrivia = saved;
      }
    }
    return w.getSince(mark);
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
      ? prepareBufferPrintState(context, options, buffer)
      : prepareRenderPrintState(context, printOptions);
    const mark = buffer ? prepared.writer.mark() : 0;
    if (buffer && this.hasFlag(F_STATIC)) {
      this.writeQueryConditionSyntax(this.value, prepared);
      return writePreparedRenderText(buffer, prepared, mark, prepared.writer.getSince(mark));
    }
    const rendered = this.hasFlag(F_STATIC)
      ? this.renderQueryConditionSyntax(this.value, prepared)
      : this.renderQueryConditionValue(this.value, prepared, context);
    if (isThenable(rendered)) {
      return buffer
        ? writePreparedRenderTextResult(buffer, prepared, mark, rendered)
        : rendered;
    }
    return buffer
      ? writePreparedRenderText(buffer, prepared, mark, rendered)
      : rendered;
  }
}
export const query = defineType(QueryCondition, 'QueryCondition', 'query');
