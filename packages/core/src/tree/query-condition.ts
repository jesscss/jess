import type { Context } from '../context.js';
import { OutputWriter, type FinalPrintOptions, getPrintOptions, prepareRenderPrintState, type PrintOptions } from './util/print.js';
import { defineType, F_STATIC, type Node } from './node.js';
import { Sequence } from './sequence.js';
import { Paren } from './paren.js';
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
  private canWriteStaticChildDirect(node: Node): boolean {
    return (
      node.type === 'Any'
      || node.type === 'Anonymous'
      || node.type === 'Keyword'
      || node.type === 'Dimension'
      || node.type === 'Num'
      || node.type === 'Bool'
      || node.type === 'Color'
      || node.constructor === Paren
    );
  }

  private writeStaticChild(node: Node, options: FinalPrintOptions): void {
    if (this.canWriteStaticChildDirect(node)) {
      node.writeSyntax(options);
      return;
    }
      const mark = options.writer.mark();
    node.writeSyntax(options);
    const text = options.writer.getSince(mark);
    if (text === '') {
      node.toTrimmedString(options);
    }
  }

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
        this.writeStaticChild(value[i]!, options);
      } finally {
        options.suppressBoundaryTrivia = saved;
      }
    }
  }

  private renderQueryConditionSyntax(value: Node[], options?: PrintOptions, context?: Context): string | MaybePromise<string> {
    options = getPrintOptions(options);
    const w = options.writer;
    const length = value.length;

    if (length === 0) {
      return '';
    }

    if (!context) {
      const mark = w.mark();
      this.writeQueryConditionSyntax(value, options);
      return w.getSince(mark);
    }

    const emitTrimmed = (node: Node): MaybePromise<string | void> => {
      const saved = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      if (node.hasFlag(F_STATIC)) {
        try {
          const rendered = node.render(context, options);
          if (isThenable(rendered)) {
            const before = w.mark();
            return rendered.then(
              (out) => {
                if (!w.hasContentSince(before)) {
                  w.add(out);
                } else {
                  return w.getSince(before);
                }
                options.suppressBoundaryTrivia = saved;
                return out;
              },
              (error) => {
                options.suppressBoundaryTrivia = saved;
                throw error;
              }
            );
          }
          return rendered;
        } finally {
          options.suppressBoundaryTrivia = saved;
        }
      }
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
              if (w.position() === before) {
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
        if (typeof out === 'string') {
          if (!w.hasContentSince(before)) {
            w.add(out);
          } else {
            return w.getSince(before);
          }
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

    return w.toString();

    async function renderRest(start: number): Promise<string> {
      for (let i = start; i < length; i++) {
        if (i > 0) {
          w.add(' ');
        }
        await emitTrimmed(value[i]!);
      }
      return w.toString();
    }
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    this.writeQueryConditionSyntax(this.value, options);
  }

  override toTrimmedString(options?: PrintOptions): string {
    if (this.value.length === 0) {
      return '';
    }
    const printOptions = getPrintOptions(options);
    const mark = printOptions.writer.mark();
    this.writeSyntax(printOptions);
    return printOptions.writer.getSince(mark);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const printOptions = buffer ? options : bufferOrOptions;
    const sharesWriter = Boolean(buffer && 'shareWriter' in buffer && buffer.shareWriter);
    const prepared = buffer
      ? sharesWriter
        ? prepareRenderPrintState(context, {
            ...options,
            writer: buffer.kind === 'flat' && context.printState.writer?.writesTo(buffer.parts)
              ? context.printState.writer
              : new OutputWriter(false, buffer.kind === 'flat' ? buffer.parts : undefined)
          })
        : prepareBufferPrintState(context, options)
      : prepareRenderPrintState(context, printOptions);
    if (this.hasFlag(F_STATIC)) {
      this.writeQueryConditionSyntax(this.value, prepared);
      const rendered = sharesWriter
        ? buffer!.kind === 'flat'
          ? buffer!.parts.join('')
          : prepared.writer.toString()
        : prepared.writer.toString();
      return buffer
        ? sharesWriter ? rendered : writeRenderText(buffer, rendered)
        : rendered;
    }
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
