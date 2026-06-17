import type { Context } from '../context.js';
import { Any } from './any.js';
import { Dimension } from './dimension.js';
import { Node, defineType } from './node.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { isRenderBuffer, writeRenderText, type RenderBuffer } from './util/render-buffer.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import round from 'lodash-es/round.js';

export type RangeValue = {
  start: Node;
  end: Node;
  step?: Node;
};

export type RangeOptions = {
  /** If false, serialize as `1> to ...` */
  includeStart?: boolean;
  /** If false, serialize as `... to <3` */
  includeEnd?: boolean;
};

/**
 * A numeric-ish range expression intended for `$for` headers.
 *
 * Examples:
 * - `1 to 3`         (inclusive start/end)
 * - `1 to <3`        (exclusive end)
 * - `1> to 3`        (exclusive start)
 * - `1> to <10 step 2`
 */
export class Range extends Node<RangeValue, RangeOptions> {
  private scalarBoundText(value: Node): string | undefined {
    if (value instanceof Any) {
      return value.value;
    }
    if (value instanceof Dimension) {
      const unit = value.value.unit ?? '';
      if (unit.includes('/') || unit.includes('*') || unit.includes('±')) {
        return undefined;
      }
      return `${round(value.value.number, 8)}`.toLowerCase() + unit;
    }
    return undefined;
  }

  private scalarRangeText(options?: PrintOptions): string | undefined {
    if (options?.trivia || options?.sourceMap) {
      return undefined;
    }
    const { start, end, step } = this.value;
    const startText = this.scalarBoundText(start);
    const endText = this.scalarBoundText(end);
    const stepText = step ? this.scalarBoundText(step) : undefined;
    if (startText === undefined || endText === undefined || (step && stepText === undefined)) {
      return undefined;
    }
    const includeStart = this._options?.includeStart !== false;
    const includeEnd = this._options?.includeEnd !== false;
    return startText
      + (includeStart ? '' : '>')
      + ' to '
      + (includeEnd ? '' : '<')
      + endText
      + (step ? ` step ${stepText}` : '');
  }

  override evalNode(_context: Context): Range {
    // Parsing-only for now; semantics can be implemented later.
    return this;
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    const { start, end, step } = this.value;
    const includeStart = this._options?.includeStart !== false;
    const includeEnd = this._options?.includeEnd !== false;

    const saved = options.suppressBoundaryTrivia;
    options.suppressBoundaryTrivia = 'pre';
    start.writeSyntax(options);
    options.suppressBoundaryTrivia = saved;
    if (!includeStart) {
      w.add('>');
    }
    w.add(' to ');
    if (!includeEnd) {
      w.add('<');
    }
    options.suppressBoundaryTrivia = 'pre';
    end.writeSyntax(options);
    options.suppressBoundaryTrivia = saved;
    if (step) {
      w.add(' step ');
      options.suppressBoundaryTrivia = 'pre';
      step.writeSyntax(options);
      options.suppressBoundaryTrivia = saved;
    }
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const out = this.scalarRangeText(options);
    if (out !== undefined) {
      options.writer.add(out, this);
      return out;
    }
    const mark = options.writer.mark();
    this.writeSyntax(options);
    const w = options.writer;
    return w.getSince(mark);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): string;
  override render(context: Context, options?: PrintOptions): string;
  override render(_context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const printOptions = buffer ? options : bufferOrOptions;
    const out = this.scalarRangeText(printOptions);
    if (out !== undefined) {
      return buffer
        ? writeRenderText(buffer, out)
        : (getPrintOptions(printOptions).writer.add(out, this), out);
    }
    return buffer
      ? super.render(_context, buffer, options)
      : super.render(_context, printOptions);
  }
}

type RangeParams = ConstructorParameters<typeof Range>;

export const range = defineType(Range, 'Range', 'range') as (
  value: RangeParams[0],
  options?: RangeParams[1],
  location?: RangeParams[2]
) => Range;
