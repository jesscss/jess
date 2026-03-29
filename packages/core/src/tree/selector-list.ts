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
import { setField } from './util/field-helpers.js';

export type SelectorListChildData = { value: Selector[] };

export interface SelectorList {
  type: 'SelectorList';
  shortType: 'sellist';
}

/** Constructs */
export class SelectorList extends Selector<Selector[], any, SelectorListChildData> {
  static override childKeys = ['value'] as const;

  /** @internal */ _value!: Selector[];

  constructor(value: Selector[], options?: any, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    this._value = value;
    for (const child of value) {
      if (child instanceof Selector) {
        this.adopt(child);
      }
    }
  }

  get length() {
    return this._value.length;
  }

  /** Normalize selectors on separate lines with indentation */
  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    let depth = options.depth!;
    let space = ''.padStart(depth * 2);
    // Flatten generated top-level `:is(...)` items into the selector list.
    const sourceValue = this.get('value', options.context);
    const value: Selector[] = [];
    for (const item of sourceValue) {
      if (isNode(item, N.PseudoSelector) && item.get('name') === ':is') {
        const arg = item.get('arg');
        if (arg && isNode(arg, N.SelectorList)) {
          value.push(...arg.get('value'));
          continue;
        }
      }
      if (isNode(item, N.CompoundSelector) && item.get('value').length === 1) {
        const only = item.get('value')[0]!;
        if (isNode(only, N.PseudoSelector) && only.get('name') === ':is') {
          const arg = only.get('arg');
          if (arg && isNode(arg, N.SelectorList)) {
            value.push(...arg.get('value'));
            continue;
          }
        }
      }
      if (isNode(item, N.ComplexSelector) && item.get('value').length === 1) {
        const only = item.get('value')[0]!;
        if (isNode(only, N.PseudoSelector) && only.get('name') === ':is') {
          const arg = only.get('arg');
          if (arg && isNode(arg, N.SelectorList)) {
            value.push(...arg.get('value'));
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

    for (let i = 1; i < length; i++) {
      item = value[i]!;
      w.add(`,\n${space}`);
      out = (w.capture(() => item.toString(options))).trim();
      w.add(out);
    }
    return w.getSince(mark);
  }

  override valueOf() {
    const itemValues = this._value.map(item => item.valueOf());
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
        const value = [...list.get('value', context)];
        let changed = false;
        const maybe = serialForEach(value.map((_, i) => i), (i) => {
          const out = value[i]!.eval(context);
          if (isThenable(out)) {
            return (out as Promise<Selector>).then((res) => {
              if (res !== value[i]) {
                value[i] = res as Selector;
                changed = true;
              }
              return undefined;
            });
          }
          if ((out as Selector) !== value[i]) {
            value[i] = out as Selector;
            changed = true;
          }
          return undefined;
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => {
            if (changed) {
              setField(list, 'value', value, context);
            }
            return list;
          });
        }
        if (changed) {
          setField(list, 'value', value, context);
        }
        return list;
      },
      (list) => {
        const value = list.get('value', context);
        const flattened: Selector[] = [];
        for (const item of value) {
          if (isNode(item, N.PseudoSelector) && item.get('name') === ':is') {
            const arg = item.get('arg');
            if (arg && isNode(arg, N.SelectorList)) {
              flattened.push(...arg.get('value'));
              continue;
            }
          }
          if (isNode(item, N.CompoundSelector) && item.get('value').length === 1) {
            const only = item.get('value')[0]!;
            if (isNode(only, N.PseudoSelector) && only.get('name') === ':is') {
              const arg = only.get('arg');
              if (arg && isNode(arg, N.SelectorList)) {
                flattened.push(...arg.get('value'));
                continue;
              }
            }
          }
          if (isNode(item, N.ComplexSelector) && item.get('value').length === 1) {
            const only = item.get('value')[0]!;
            if (isNode(only, N.PseudoSelector) && only.get('name') === ':is') {
              const arg = only.get('arg');
              if (arg && isNode(arg, N.SelectorList)) {
                flattened.push(...arg.get('value'));
                continue;
              }
            }
          }
          flattened.push(item);
        }
        if (flattened.length !== value.length) {
          setField(list, 'value', flattened, context);
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
