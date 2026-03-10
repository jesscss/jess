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

/** Constructs */
export class SelectorList extends Selector<Selector[]> {
  type = 'SelectorList';
  shortType = 'sellist';

  protected override _computeKeySetAndFastReject(): void {
    let combinedKeySet = new Set<string>();
    let combinedVisibleKeySet = new Set<string>();
    for (const selector of this.value) {
      for (const key of selector.keySet) {
        combinedKeySet.add(key);
      }
      for (const key of selector.visibleKeySet) {
        combinedVisibleKeySet.add(key);
      }
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
    // Flatten generated top-level `:is(...)` items into the selector list.
    // This matches Less output expectations when an extend created an :is() and it ended up being
    // the whole selector-list item.
    const value: Selector[] = [];
    for (const item of this.value) {
      // Flatten `:is(a, b)` selector-list items into `a, b`.
      // Also handle `:is(...)` wrapped in a single-item CompoundSelector.
      if (isNode(item, N.PseudoSelector) && item.value.name === ':is') {
        const arg = item.value.arg;
        if (arg && isNode(arg, N.SelectorList)) {
          value.push(...arg.value);
          continue;
        }
      }
      if (isNode(item, N.CompoundSelector) && item.value.length === 1) {
        const only = item.value[0]!;
        if (isNode(only, N.PseudoSelector) && only.value.name === ':is') {
          const arg = only.value.arg;
          if (arg && isNode(arg, N.SelectorList)) {
            value.push(...arg.value);
            continue;
          }
        }
      }
      if (isNode(item, N.ComplexSelector) && item.value.length === 1) {
        const only = item.value[0]!;
        if (isNode(only, N.PseudoSelector) && only.value.name === ':is') {
          const arg = only.value.arg;
          if (arg && isNode(arg, N.SelectorList)) {
            value.push(...arg.value);
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
    const itemValues = this.value.map(item => item.valueOf());
    return itemValues.join(',');
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
        // Flatten top-level `:is(a, b)` items into the selector list.
        // This is safe in SelectorList context (it is equivalent to `a, b`).
        const flattened: Selector[] = [];
        for (const item of value) {
          if (isNode(item, N.PseudoSelector) && item.value.name === ':is') {
            const arg = item.value.arg;
            if (arg && isNode(arg, N.SelectorList)) {
              flattened.push(...arg.value);
              continue;
            }
          }
          if (isNode(item, N.CompoundSelector) && item.value.length === 1) {
            const only = item.value[0]!;
            if (isNode(only, N.PseudoSelector) && only.value.name === ':is') {
              const arg = only.value.arg;
              if (arg && isNode(arg, N.SelectorList)) {
                flattened.push(...arg.value);
                continue;
              }
            }
          }
          if (isNode(item, N.ComplexSelector) && item.value.length === 1) {
            const only = item.value[0]!;
            if (isNode(only, N.PseudoSelector) && only.value.name === ':is') {
              const arg = only.value.arg;
              if (arg && isNode(arg, N.SelectorList)) {
                flattened.push(...arg.value);
                continue;
              }
            }
          }
          flattened.push(item);
        }
        if (flattened.length !== value.length) {
          list.value = flattened;
        }
        if (value.length === 1) {
          return value[0]!;
        }
        return list;
      }
    );
  }
}

export const sellist = defineType(SelectorList, 'SelectorList', 'sellist');