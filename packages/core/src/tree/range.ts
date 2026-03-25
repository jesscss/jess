import type { Context } from '../context.js';
import { Node, defineType, type OptionalLocation, type TreeContext } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { getField } from './util/session-helpers.js';

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
  static override childKeys = ['start', 'end', 'step'] as const;

  start!: Node;
  end!: Node;
  step: Node | undefined;

  constructor(value: RangeValue, options?: RangeOptions, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.start = value.start;
    this.end = value.end;
    this.step = value.step;
    if (this.start instanceof Node) {
      this.adopt(this.start);
    }
    if (this.end instanceof Node) {
      this.adopt(this.end);
    }
    if (this.step instanceof Node) {
      this.adopt(this.step);
    }
  }

  override evalNode(_context: Context): Range {
    return this;
  }

  private _getStart(context?: Context): Node {
    return context
      ? getField<Node>(this, 'start', context)
      : this.start;
  }

  private _getEnd(context?: Context): Node {
    return context
      ? getField<Node>(this, 'end', context)
      : this.end;
  }

  private _getStep(context?: Context): Node | undefined {
    return context
      ? getField<Node | undefined>(this, 'step', context)
      : this.step;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const context = options.context;
    const start = this._getStart(context);
    const end = this._getEnd(context);
    const step = this._getStep(context);
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
