import type { Context } from '../context.js';
import { Node, defineType, type LocationInfo } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';

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
export interface Range {
  type: 'Range';
  shortType: 'range';
}

export class Range extends Node<RangeValue, RangeOptions> {
  override evalNode(_context: Context): Range {
    // Parsing-only for now; semantics can be implemented later.
    return this;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const { start, end, step } = this.data;
    const includeStart = this.options?.includeStart !== false;
    const includeEnd = this.options?.includeEnd !== false;

    const emitTrimmed = (n: Node) => {
      const s = w.capture(() => n.toString(options));
      w.add(s.replace(/^[ \t\r\f]+|[ \t\r\f]+$/g, ''), n);
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
