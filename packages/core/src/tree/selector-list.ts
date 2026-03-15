import {
  defineType,
  F_EXTENDED,
  F_EXTEND_TARGET
} from './node.js';
import { type Context } from '../context.js';
import { Selector } from './selector.js';
import { getEntries } from './util/collections.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { selectorCompare } from './util/compare.js';

export interface SelectorList {
  type: 'SelectorList';
  shortType: 'sellist';
}

/** Constructs */
export class SelectorList extends Selector<Selector[]> {
  get length() {
    return this.data.length;
  }

  get value() {
    return this.data as Selector[];
  }

  /** Normalize selectors on separate lines with indentation */
  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    let depth = options.depth!;
    let space = ''.padStart(depth * 2);
    // Flatten generated top-level `:is(...)` items into the selector list.
    // This matches Less output expectations when an extend created an :is() and it ended up being
    // the whole selector-list item.
    const value: Selector[] = [];
    for (const item of this.data) {
      // Flatten `:is(a, b)` selector-list items into `a, b`.
      // Also handle `:is(...)` wrapped in a single-item CompoundSelector.
      if (isNode(item, N.PseudoSelector) && item.data.name === ':is') {
        const arg = item.data.arg;
        if (arg && isNode(arg, N.SelectorList)) {
          value.push(...arg.data);
          continue;
        }
      }
      if (isNode(item, N.CompoundSelector) && item.data.length === 1) {
        const only = item.data[0]!;
        if (isNode(only, N.PseudoSelector) && only.data.name === ':is') {
          const arg = only.data.arg;
          if (arg && isNode(arg, N.SelectorList)) {
            value.push(...arg.data);
            continue;
          }
        }
      }
      if (isNode(item, N.ComplexSelector) && item.data.length === 1) {
        const only = item.data[0]!;
        if (isNode(only, N.PseudoSelector) && only.data.name === ':is') {
          const arg = only.data.arg;
          if (arg && isNode(arg, N.SelectorList)) {
            value.push(...arg.data);
            continue;
          }
        }
      }
      value.push(item);
    }
    if (
      options.referenceMode === true
      && options.referenceRenderEnabled === true
      && options.referenceFilterTargets === true
    ) {
      const extendedOnly = value.filter(item =>
        item.hasFlag(F_EXTENDED) && !item.hasFlag(F_EXTEND_TARGET)
      );
      if (extendedOnly.length > 0) {
        value.splice(0, value.length, ...extendedOnly);
      }
    }
    let length = value.length;
    if (length === 0) {
      return '';
    }
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
    const itemValues = this.data.map(item => item.valueOf());
    return itemValues.join(',');
  }

  override computeKeySetAndFastReject(): void {
    super.computeKeySetAndFastReject();
    /** Selector lists represent alternates, so subsets can't fast reject */
    this._canFastReject = false;
  }

  override compare(b: Selector): 0 | 1 | -1 | undefined {
    if (!isNode(b, N.Selector)) {
      return super.compare(b as unknown as Selector);
    }
    const semantic = selectorCompare(this, b);
    if (semantic.isEquivalent) {
      return 0;
    }
    return super.compare(b);
  }

  override evalNode(context: Context): MaybePromise<SelectorList | Selector> {
    return pipe(
      () => {
        const list = super.evalNode(context) as SelectorList;
        const { data } = list;
        const maybe = serialForEach(Array.from(getEntries(data)), ([item, i]) => {
          const out = item.eval(context);
          if (isThenable(out)) {
            return (out as Promise<Selector>).then((res) => {
              list.setData(i, res as Selector);
              return undefined;
            });
          }
          list.setData(i, out as Selector);
          return undefined;
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => list);
        }
        return list;
      },
      (list) => {
        const { data } = list;
        // Flatten top-level `:is(a, b)` items into the selector list.
        // This is safe in SelectorList context (it is equivalent to `a, b`).
        const flattened: Selector[] = [];
        for (const item of data) {
          if (isNode(item, N.PseudoSelector) && item.data.name === ':is') {
            const arg = item.data.arg;
            if (arg && isNode(arg, N.SelectorList)) {
              flattened.push(...arg.data);
              continue;
            }
          }
          if (isNode(item, N.CompoundSelector) && item.data.length === 1) {
            const only = item.data[0]!;
            if (isNode(only, N.PseudoSelector) && only.data.name === ':is') {
              const arg = only.data.arg;
              if (arg && isNode(arg, N.SelectorList)) {
                flattened.push(...arg.data);
                continue;
              }
            }
          }
          if (isNode(item, N.ComplexSelector) && item.data.length === 1) {
            const only = item.data[0]!;
            if (isNode(only, N.PseudoSelector) && only.data.name === ':is') {
              const arg = only.data.arg;
              if (arg && isNode(arg, N.SelectorList)) {
                flattened.push(...arg.data);
                continue;
              }
            }
          }
          flattened.push(item);
        }
        if (flattened.length !== data.length) {
          list.setData(flattened);
        }
        if (data.length === 1) {
          return data[0]!;
        }
        return list;
      }
    );
  }
}

export const sellist = defineType(SelectorList, 'SelectorList', 'sellist');