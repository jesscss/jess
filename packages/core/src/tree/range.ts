import type { Context } from '../context.js';
import { Node, defineType } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  type RenderBuffer,
  renderSelectedOutput,
  writeSelectedOutput
} from './util/render-buffer.js';

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
  override evalNode(_context: Context): Range {
    // Parsing-only for now; semantics can be implemented later.
    return this;
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      return writeSelectedOutput(bufferOrOptions, this.evalNode(context), context, options);
    }
    return renderSelectedOutput(this.evalNode(context), context, bufferOrOptions);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const { start, end, step } = this.value;
    const includeStart = this._options?.includeStart !== false;
    const includeEnd = this._options?.includeEnd !== false;

    const emitTrimmed = (n: Node) => {
      const saved = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      try {
        n.toString(options);
      } finally {
        options.suppressBoundaryTrivia = saved;
      }
    };

    emitTrimmed(start);
    if (!includeStart) {
      w.add('>');
    }
    w.add(' to ');
    if (!includeEnd) {
      w.add('<');
    }
    emitTrimmed(end);
    if (step) {
      w.add(' step ');
      emitTrimmed(step);
    }
    return w.getSince(mark);
  }
}

type RangeParams = ConstructorParameters<typeof Range>;

export const range = defineType(Range, 'Range', 'range') as (
  value: RangeParams[0],
  options?: RangeParams[1],
  location?: RangeParams[2],
  treeContext?: RangeParams[3]
) => Range;
