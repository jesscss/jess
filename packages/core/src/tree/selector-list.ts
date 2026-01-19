import {
  defineType
} from './node.js';
import { type Context } from '../context.js';
import { Selector } from './selector.js';
import { getEntries } from './util/collections.js';
import { type PrintOptions, getPrintOptions, OutputWriter } from './util/print.js';
import { normalizeContinuationIndent } from './util/format.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';

/** Constructs */
export class SelectorList extends Selector<Selector[]> {
  type = 'SelectorList';
  shortType = 'sellist';

  protected override _computeKeySetAndFastReject(): void {
    let combinedKeySet = new Set<string>();
    let combinedVisibleKeySet = new Set<string>();
    for (const selector of this.value) {
      combinedKeySet = combinedKeySet.union(selector.keySet);
      combinedVisibleKeySet = combinedVisibleKeySet.union(selector.visibleKeySet);
    }

    this._keySet = combinedKeySet;
    this._visibleKeySet = combinedVisibleKeySet;
    // SelectorLists represent alternatives - can't use fast rejection
    this._canFastReject = false;
  }

  /** Normalize selectors on separate lines with indentation */
  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    let depth = options.depth!;
    let space = ''.padStart(depth * 2);
    let value = this.value;
    let length = value.length;
    const mark = w.mark();
    let item = value[0]!;

    let out = w.capture(() => item.toString(options));
    w.add(out.trim(), item);

    // Subsequent items: emit sep; capture next item to decide spacing precisely
    for (let i = 1; i < length; i++) {
      item = value[i]!;
      w.add(`,\n${space}`);
      out = (w.capture(() => item.toString(options))).trim();
      w.add(out);
    }
    return w.getSince(mark);
  }

  override valueOf() {
    return this.value.map(v => v.valueOf()).join(',');
  }

  override evalNode(context: Context): MaybePromise<SelectorList | Selector> {
    return pipe(
      () => {
        const list = this;
        const { value } = list;
        const maybe = serialForEach(Array.from(getEntries(value)), ([item, i]) => {
          const out = item.eval(context);
          if (isThenable(out)) {
            return (out as Promise<Selector>).then((res) => {
              value[i] = res as Selector;
              return undefined;
            });
          }
          value[i] = out as Selector;
          return undefined;
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => list);
        }
        return list;
      },
      (list) => {
        const { value } = list;
        if (value.length === 1) {
          return value[0]!;
        }
        return list;
      }
    );
  }
}

export const sellist = defineType(SelectorList, 'SelectorList', 'sellist');