import type { Context } from '../context.js';
import { type FinalPrintOptions, getPrintOptions, prepareRenderPrintState, type PrintOptions } from './util/print.js';
import { defineType, F_STATIC, Node } from './node.js';
import { Sequence } from './sequence.js';
import { Any } from './any.js';
import { Bool } from './bool.js';
import { Color } from './color.js';
import { Dimension } from './dimension.js';
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
  private canRenderDirectQueryChild(node: Node): boolean {
    const nodeType = node.type;
    return node.hasFlag(F_STATIC)
      && (node.visible || node.fullRender)
      && (
        (
          (
            nodeType === 'Any'
            || nodeType === 'Anonymous'
            || nodeType === 'Keyword'
          )
          && node.render === Any.prototype.render
        )
        || (nodeType === 'Bool' && node.render === Bool.prototype.render)
        || (
          (
            nodeType === 'Dimension'
            || nodeType === 'Num'
          )
          && node.render === Dimension.prototype.render
        )
        || (
          node instanceof Color
          && node.render === Color.prototype.render
          && (
            node.value.node === undefined
            || typeof node.value.node === 'string'
          )
        )
      );
  }

  private writeQueryChildBoundary(options: FinalPrintOptions): string {
    options.writer.add(' ');
    return ' ';
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

  private renderStaticQueryConditionValue(value: Node[], options: FinalPrintOptions, context: Context): string {
    const length = value.length;

    if (length === 0) {
      return '';
    }

    const w = options.writer;
    let out = '';
    for (let i = 0; i < length; i++) {
      if (i > 0) {
        out += this.writeQueryChildBoundary(options);
      }
      const node = value[i]!;
      const saved = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      try {
        if (this.canRenderDirectQueryChild(node)) {
          out += node.render(context, options);
          continue;
        }
        const before = w.mark();
        node.writeSyntax(options);
        out += w.getSince(before);
      } finally {
        options.suppressBoundaryTrivia = saved;
      }
    }

    return out;
  }

  private renderQueryConditionValue(value: Node[], options: FinalPrintOptions, context: Context): MaybePromise<string> {
    const length = value.length;

    if (length === 0) {
      return '';
    }

    const w = options.writer;
    let out = '';
    for (let i = 0; i < length; i++) {
      if (i > 0) {
        out += this.writeQueryChildBoundary(options);
      }
      const node = value[i]!;
      const saved = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      let asyncOut = false;
      try {
        if (this.canRenderDirectQueryChild(node)) {
          out += node.render(context, options);
        } else {
          const before = w.mark();
          const rendered = node.render(context, options);
          if (isThenable(rendered)) {
            asyncOut = true;
            return rendered.then(
              (renderedOut) => {
                if (!w.hasContentSince(before)) {
                  w.add(renderedOut);
                  options.suppressBoundaryTrivia = saved;
                  return this.renderQueryConditionValueRest(value, options, context, out + renderedOut, i + 1);
                }
                const written = w.getSince(before);
                options.suppressBoundaryTrivia = saved;
                return this.renderQueryConditionValueRest(value, options, context, out + written, i + 1);
              },
              (error) => {
                options.suppressBoundaryTrivia = saved;
                throw error;
              }
            );
          }
          if (!w.hasContentSince(before)) {
            w.add(rendered);
            out += rendered;
          } else {
            out += w.getSince(before);
          }
        }
      } finally {
        if (!asyncOut) {
          options.suppressBoundaryTrivia = saved;
        }
      }
    }

    return out;
  }

  private async renderQueryConditionValueRest(
    value: Node[],
    options: FinalPrintOptions,
    context: Context,
    out: string,
    start: number
  ): Promise<string> {
    const w = options.writer;
    for (let i = start; i < value.length; i++) {
      if (i > 0) {
        out += this.writeQueryChildBoundary(options);
      }
      const node = value[i]!;
      const saved = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      try {
        if (this.canRenderDirectQueryChild(node)) {
          out += node.render(context, options);
          continue;
        }
        const before = w.mark();
        const rendered = await node.render(context, options);
        if (!w.hasContentSince(before)) {
          w.add(rendered);
          out += rendered;
        } else {
          out += w.getSince(before);
        }
      } finally {
        options.suppressBoundaryTrivia = saved;
      }
    }
    return out;
  }

  private writeQueryConditionRenderText(buffer: RenderBuffer, options: FinalPrintOptions, text: string): string {
    return buffer.kind === 'flat' && options.writer.writesTo(buffer.parts)
      ? text
      : writeRenderText(buffer, text);
  }

  private writeQueryConditionRenderTextResult(
    buffer: RenderBuffer,
    options: FinalPrintOptions,
    text: MaybePromise<string>
  ): MaybePromise<string> {
    return isThenable(text)
      ? text.then(resolved => this.writeQueryConditionRenderText(buffer, options, resolved))
      : this.writeQueryConditionRenderText(buffer, options, text);
  }

  override toTrimmedString(options?: PrintOptions): string {
    return this.renderQueryConditionSyntax(this.value, options);
  }

  /** @internal */
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
    const rendered = this.hasFlag(F_STATIC)
      ? this.renderStaticQueryConditionValue(this.value, prepared, context)
      : this.renderQueryConditionValue(this.value, prepared, context);
    if (isThenable(rendered)) {
      return buffer
        ? this.writeQueryConditionRenderTextResult(buffer, prepared, rendered)
        : rendered;
    }
    return buffer
      ? this.writeQueryConditionRenderText(buffer, prepared, rendered)
      : rendered;
  }
}
export const query = defineType(QueryCondition, 'QueryCondition', 'query');
