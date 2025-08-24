import {
  defineType
} from './node';
import { type Context } from '../context';
import { Selector } from './selector';
import { getEntries } from './util/collections';
import { type PrintOptions, getPrintOptions, OutputWriter } from './util/print.js';
import { normalizeContinuationIndent } from './util/format';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';

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
      if (i > 0) {
        w.add('\n');
        w.add(space);
      }
      // Emit trimmed selector (no outer pre/post) to avoid duplicating newlines
      this.value[i]!.toTrimmedString(options);
      if (i < length - 1) {
        w.add(',');
      }
    }
    return w.getSince(mark);
  }

  override valueOf() {
    return this.value.map(v => v.valueOf()).join(',');
  }

  override evalNode(context: Context): MaybePromise<SelectorList | Selector> {
    return pipe(
      () => {
        const list = this.maybeClone(context);
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