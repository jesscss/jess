import {
  defineType
} from './node';
import { type Context } from '../context';
import { Selector } from './selector';
import { getEntries } from './util/collections';
import { type PrintOptions, getPrintOptions, OutputWriter } from './util/print.js';
import { normalizeContinuationIndent } from './util/format';

/** Constructs */
export class SelectorList extends Selector<Selector[]> {
  type = 'SelectorList';
  shortType = 'sellist';

  protected override _computeKeySetAndFastReject(): void {
    let combinedKeySet = new Set<string>();

    for (const selector of this.value) {
      combinedKeySet = combinedKeySet.union(selector.keySet);
    }

    this._keySet = combinedKeySet;
    // SelectorLists represent alternatives - can't use fast rejection
    this._canFastReject = false;
  }

  /** Normalize selectors on separate lines with indentation */
  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    let depth = options.depth ?? 0;
    let space = ''.padStart(depth * 2);
    let length = this.value.length;
    const mark = w.mark();
    for (let i = 0; i < length; i++) {
      // Render selector into a temporary writer so we can control placement
      const childWriter = new OutputWriter();
      const selOptions: PrintOptions = { ...options, writer: childWriter };
      const selStr = this.value[i]!.toString(selOptions);
      const selOut = childWriter.toString() || selStr || '';
      // Put subsequent selectors on their own new line at current depth
      if (i > 0) {
        w.add('\n');
        w.add(space);
      }
      const normalized = normalizeContinuationIndent(selOut, space);
      w.add(normalized);
      if (i < length - 1) {
        w.add(',');
      }
    }
    return w.getSince(mark);
  }

  override valueOf() {
    return this.value.map(v => v.valueOf()).join(',');
  }

  override async evalNode(context: Context): Promise<SelectorList | Selector> {
    const list = this.maybeClone(context);
    const { value } = list;
    for (let [item, i] of getEntries(value)) {
      value[i] = await item.eval(context) as Selector;
    }
    if (value.length === 1) {
      return value[0]!;
    }
    return list;
  }
}

export const sellist = defineType(SelectorList, 'SelectorList', 'sellist');