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
  static override childKeys = ['items'] as const;

  /**
   * Fast-path only node classes whose source syntax writer is known to be
   * concrete in the current tree model.
   *
   * Query conditions are intentionally stricter than generic `Node.writeSyntax`
   * because this path is used to prove static query rendering does not fall
   * back to writer readback, child render, or public string transport. A node
   * should be added here only after its own class owns a direct `writeSyntax`
   * implementation that writes the exact authored syntax and does not rely on
   * `Node.toTrimmedString()` readback.
   *
   * Remove this whitelist when every node type that can appear in parser-owned
   * query conditions has a direct `writeSyntax` contract. At that point
   * `writeStaticChild` can call `node.writeSyntax(options)` unconditionally and
   * the fallback tests below should be deleted or moved to a cold extension
   * compatibility path.
   */
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

  /**
   * Static query syntax writer with a temporary fallback for custom/subclassed
   * nodes that may not yet participate in the direct writer contract.
   *
   * The fallback exists only to keep custom overrides, such as a subclassed
   * `Paren.writeSyntax`, correct while the node family migration is incomplete.
   * It intentionally performs a small writer readback for unknown static
   * children, so those children must not be normalized into the fast path until
   * their concrete class owns direct syntax output.
   *
   * Expected deletion condition: once query-condition child types no longer use
   * inherited/default `Node.writeSyntax` for real source syntax, delete
   * `canWriteStaticChildDirect`, delete this fallback branch, and make this
   * method a straight `node.writeSyntax(options)` call.
   */
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

    for (let i = 0; i < length; i++) {
      if (i > 0) {
        w.add(' ');
      }
      const rendered = this.renderQueryConditionChild(value[i]!, options, context);
      if (isThenable(rendered)) {
        return (rendered as Promise<string | void>)
          .then(() => this.renderQueryConditionRest(value, options, context, i + 1));
      }
    }

    return w.toString();
  }

  private renderQueryConditionChild(
    node: Node,
    options: FinalPrintOptions,
    context: Context
  ): MaybePromise<string | void> {
    const w = options.writer;
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
      const out = node.render(context, options);
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
  }

  private async renderQueryConditionRest(
    value: Node[],
    options: FinalPrintOptions,
    context: Context,
    start: number
  ): Promise<string> {
    const w = options.writer;
    const length = value.length;
    for (let i = start; i < length; i++) {
      if (i > 0) {
        w.add(' ');
      }
      await this.renderQueryConditionChild(value[i]!, options, context);
    }
    return w.toString();
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    this.writeQueryConditionSyntax(this.items, options);
  }

  override toTrimmedString(options?: PrintOptions): string {
    if (this.items.length === 0) {
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
      this.writeQueryConditionSyntax(this.items, prepared);
      const rendered = sharesWriter
        ? buffer!.kind === 'flat'
          ? buffer!.parts.join('')
          : prepared.writer.toString()
        : prepared.writer.toString();
      return buffer
        ? sharesWriter ? rendered : writeRenderText(buffer, rendered)
        : rendered;
    }
    const rendered = this.renderQueryConditionSyntax(this.items, prepared, context);
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
