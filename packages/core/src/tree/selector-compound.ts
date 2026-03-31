import {
  defineType,
  type OptionalLocation
} from './node.js';
import type { Context } from '../context.js';
import { Nil } from './nil.js';
import { Selector } from './selector.js';
import type { SimpleSelector } from './selector-simple.js';
import { isNode } from './util/is-node.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { N } from './node-type.js';

export type CompoundSelectorChildData = { value: SimpleSelector[] };

/**
 * @example
 * .class#id
 *
 * Must have at least 2 selectors. Otherwise it would be collapsed.
 */
/** Anything other than type (element) or universal, which must come first */
const nonElementRegex = /^[.#:[]/;
export interface CompoundSelector {
  type: 'CompoundSelector';
  shortType: 'compound';
}
export class CompoundSelector extends Selector<SimpleSelector[], any, CompoundSelectorChildData> {
  static override childKeys = ['value'] as const;

  value!: SimpleSelector[];

  constructor(value: SimpleSelector[], options?: any, location?: any, treeContext?: any) {
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

  override clone(_deep?: boolean): this {
    return this._withValue(this.value) as this;
  }

  private _withValue(value: SimpleSelector[]): CompoundSelector {
    const location = Array.isArray(this.location) && this.location.length === 6
      ? this.location as OptionalLocation
      : undefined;
    const node = new (this.constructor as typeof CompoundSelector)(
      [],
      this.options ? { ...this.options } : undefined,
      location,
      this.treeContext
    );
    node.inherit(this);
    node.value = value;
    return node;
  }

  override valueOf() {
    let value = this._valueOf;
    if (!value) {
      const components = this.value;

      const elementSelectors: string[] = [];
      const nonElementSelectors: string[] = [];

      const processComponents = (components: SimpleSelector[]) => {
        for (const component of components) {
          if (
            isNode(component, N.PseudoSelector)
            && component.get('name') === ':is'
            && isNode(component.get('arg'), N.CompoundSelector)
          ) {
            processComponents((component.get('arg') as CompoundSelector).get('value'));
            continue;
          }
          value = component.valueOf();
          if (!nonElementRegex.test(value)) {
            elementSelectors.push(value);
          } else {
            nonElementSelectors.push(value);
          }
        }
      };
      processComponents(components);

      value = [...elementSelectors, ...nonElementSelectors.sort()].join('');
      this._valueOf = value;
    }
    return value;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const data = this.get('value', options.context);
    const mark = w.mark();
    for (const item of data) {
      const out = w.capture(() => item.toString(options));
      w.add(out.trim(), item);
    }
    return w.getSince(mark);
  }

  override evalNode(context: Context): MaybePromise<CompoundSelector | Selector | Nil> {
    return pipe(
      () => {
        const sel = super.evalNode(context) as CompoundSelector;
        const value = [...sel.get('value', context)];
        let changed = false;
        const maybe = serialForEach(value.map((_, i) => i), (i: number) => {
          const out = value[i]!.eval(context);
          if (isThenable(out)) {
            return (out as Promise<SimpleSelector>).then((res) => {
              if (res !== value[i]) {
                value[i] = res as SimpleSelector;
                changed = true;
              }
              return undefined;
            });
          }
          if ((out as SimpleSelector) !== value[i]) {
            value[i] = out as SimpleSelector;
            changed = true;
          }
          return undefined;
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => {
            if (changed) {
              return sel === this
                ? this._withValue(value)
                : (() => {
                    sel.value = value;
                    return sel;
                  })();
            }
            return sel;
          });
        }
        if (changed) {
          return sel === this
            ? this._withValue(value)
            : (() => {
                sel.value = value;
                return sel;
              })();
        }
        return sel;
      },
      (sel) => {
        let data: SimpleSelector[] = sel.get('value', context).filter(n => n && !(n instanceof Nil));
        data = data.sort((a: SimpleSelector, b: SimpleSelector) => {
          let aIsElement = !nonElementRegex.test(a.valueOf());
          let bIsElement = !nonElementRegex.test(b.valueOf());
          if (aIsElement && bIsElement) {
            return a.valueOf() < b.valueOf() ? -1 : 1;
          }
          return aIsElement ? -1 : bIsElement ? 1 : 0;
        });
        if (data.length === 0) {
          return (new Nil()).inherit(this);
        }
        if (data.length === 1) {
          return data[0]!.inherit(this) as Selector;
        }
        const nextValue = [...data];
        return sel === this
          ? this._withValue(nextValue)
          : (() => {
              sel.value = nextValue;
              return sel;
            })();
      }
    );
  }
}

export const compound = defineType(CompoundSelector, 'CompoundSelector', 'compound');
