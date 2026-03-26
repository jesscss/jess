import {
  defineType,
  F_EXTENDED,
  F_EXTEND_TARGET
} from './node.js';
import { type Context } from '../context.js';
import { Selector } from './selector.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { selectorMatch } from './util/selector-match-core.js';
import { getField, setField } from './util/session-helpers.js';

export interface SelectorList {
  type: 'SelectorList';
  shortType: 'sellist';
}

/** Constructs */
export class SelectorList extends Selector<Selector[]> {
  static override childKeys = ['value'] as const;

  value!: Selector[];

  constructor(value: Selector[], options?: any, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    this.value = value;
    for (const child of value) {
      if (child instanceof Selector) {
        this.adopt(child);
      }
    }
  }

  get length() {
    return this.value.length;
  }

  private _getValue(context?: Context): Selector[] {
    return context
      ? getField<Selector[]>(this, 'value', context)
      : this.value;
  }

  private _setValue(value: Selector[], context: Context): void {
    for (const child of value) {
      if (child instanceof Selector) {
        this.adopt(child, context);
      }
    }
    if (context.session && this === this.sourceNode) {
      setField(this, 'value', value, context);
    } else {
      this.value = value;
    }
    this.invalidateCache();
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
    const sourceValue = this._getValue(options.context);
    const value: Selector[] = [];
    for (const item of sourceValue) {
      // Flatten `:is(a, b)` selector-list items into `a, b`.
      // Also handle `:is(...)` wrapped in a single-item CompoundSelector.
      if (isNode(item, N.PseudoSelector) && item.name === ':is') {
        const arg = item.arg;
        if (arg && isNode(arg, N.SelectorList)) {
          value.push(...arg.value);
          continue;
        }
      }
      if (isNode(item, N.CompoundSelector) && item.value.length === 1) {
        const only = item.value[0]!;
        if (isNode(only, N.PseudoSelector) && only.name === ':is') {
          const arg = only.arg;
          if (arg && isNode(arg, N.SelectorList)) {
            value.push(...arg.value);
            continue;
          }
        }
      }
      if (isNode(item, N.ComplexSelector) && item.value.length === 1) {
        const only = item.value[0]!;
        if (isNode(only, N.PseudoSelector) && only.name === ':is') {
          const arg = only.arg;
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

  override compare(b: Selector, context?: Context): 0 | 1 | -1 | undefined {
    if (!isNode(b, N.Selector)) {
      return super.compare(b as unknown as Selector, context);
    }
    const semantic = selectorMatch(this, b, undefined, context);
    if (semantic.fullMatch) {
      return 0;
    }
    return super.compare(b, context);
  }

  override evalNode(context: Context): MaybePromise<SelectorList | Selector> {
    return pipe(
      () => {
        const list = super.evalNode(context) as SelectorList;
        const value = [...list._getValue(context)];
        const indices = value.map((_, i) => i);
        const maybe = serialForEach(indices, (i) => {
          const out = value[i]!.eval(context);
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
          return (maybe as Promise<void>).then(() => {
            list._setValue(value, context);
            return list;
          });
        }
        list._setValue(value, context);
        return list;
      },
      (list) => {
        const value = list._getValue(context);
        // Flatten top-level `:is(a, b)` items into the selector list.
        // This is safe in SelectorList context (it is equivalent to `a, b`).
        const flattened: Selector[] = [];
        for (const item of value) {
          if (isNode(item, N.PseudoSelector) && item.name === ':is') {
            const arg = item.arg;
            if (arg && isNode(arg, N.SelectorList)) {
              flattened.push(...arg.value);
              continue;
            }
          }
          if (isNode(item, N.CompoundSelector) && item.value.length === 1) {
            const only = item.value[0]!;
            if (isNode(only, N.PseudoSelector) && only.name === ':is') {
              const arg = only.arg;
              if (arg && isNode(arg, N.SelectorList)) {
                flattened.push(...arg.value);
                continue;
              }
            }
          }
          if (isNode(item, N.ComplexSelector) && item.value.length === 1) {
            const only = item.value[0]!;
            if (isNode(only, N.PseudoSelector) && only.name === ':is') {
              const arg = only.arg;
              if (arg && isNode(arg, N.SelectorList)) {
                flattened.push(...arg.value);
                continue;
              }
            }
          }
          flattened.push(item);
        }
        if (flattened.length !== value.length) {
          list._setValue(flattened, context);
        }
        if (flattened.length === 1) {
          return flattened[0]!;
        }
        return list;
      }
    );
  }
}

export const sellist = defineType(SelectorList, 'SelectorList', 'sellist');
