import type { Context } from '../context.js';
import { Node, defineType, type OptionalLocation, type TreeContext } from './node.js';
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

export type RangeChildData = { start: Node; end: Node; step: Node | undefined };

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

export class Range extends Node<RangeValue, RangeOptions, RangeChildData> {
  static override childKeys = ['start', 'end', 'step'] as const;

  /** @internal */ _start!: Node;
  /** @internal */ _end!: Node;
  /** @internal */ _step: Node | undefined;

  constructor(value: RangeValue, options?: RangeOptions, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this._start = value.start;
    this._end = value.end;
    this._step = value.step;
    if (this._start instanceof Node) {
      this.adopt(this._start);
    }
    if (this._end instanceof Node) {
      this.adopt(this._end);
    }
    if (this._step instanceof Node) {
      this.adopt(this._step);
    }
  }

  override evalNode(_context: Context): Range {
    return this;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const context = options.context;
    const start = this.get('start', context);
    const end = this.get('end', context);
    const step = this.get('step', context);
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
