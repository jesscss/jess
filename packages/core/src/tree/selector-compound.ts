import {
  defineType
} from './node.js';
import type { Context } from '../context.js';
import { Nil } from './nil.js';
import { Selector } from './selector.js';
import type { SimpleSelector } from './selector-simple.js';
import { isNode } from './util/is-node.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import type { PrintOptions } from './util/print.js';
import { N } from './node-type.js';

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
export class CompoundSelector extends Selector<SimpleSelector[]> {
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

  override valueOf() {
    let value = this._valueOf;
    if (!value) {
      // Convert selectors to strings
      const components = this.value;

      // Find element selectors (those that don't start with .#:[)
      const elementSelectors: string[] = [];
      const nonElementSelectors: string[] = [];

      const processComponents = (components: SimpleSelector[]) => {
        for (const component of components) {
          if (
            isNode(component, N.PseudoSelector)
            && component.name === ':is'
          ) {
            let arg = component.arg;
            if (isNode(arg, N.CompoundSelector)) {
              processComponents(arg.value);
              continue;
            } else {
              value = String(arg!.valueOf());
            }
          } else {
            value = component.valueOf();
          }
          if (!nonElementRegex.test(value)) {
            elementSelectors.push(value);
          } else {
            nonElementSelectors.push(value);
          }
        }
      };
      processComponents(components);

      // Element selectors must come first for valid CSS
      // Non-element selectors maintain their original order (no sorting)
      value = [...elementSelectors, ...nonElementSelectors.sort()].join('');
      this._valueOf = value;
    }
    return value;
  }

  override toTrimmedString(options?: PrintOptions): string {
    // Components in a compound selector are joined without spaces.
    // However, parser/copy/extend pipelines can preserve `post=1` (single space) on components,
    // which would serialize `.e.e` as `.e .e`. Normalize here as a final guard.
    const data = this.value;
    for (let i = 0; i < data.length - 1; i++) {
      (data[i] as any).post = undefined;
    }
    return super.toTrimmedString(options);
  }

  override evalNode(context: Context): MaybePromise<CompoundSelector | Selector | Nil> {
    return pipe(
      () => {
        const sel = super.evalNode(context) as CompoundSelector;
        const { value } = sel;
        const indices = value.map((_: any, i: number) => i);
        const maybe = serialForEach(indices, (i: number) => {
          const out = value[i]!.eval(context);
          if (isThenable(out)) {
            return (out as Promise<SimpleSelector>).then((res) => {
              sel.setData(i, res as SimpleSelector);
              return undefined;
            });
          }
          sel.setData(i, out as SimpleSelector);
          return undefined;
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => sel);
        }
        return sel;
      },
      (sel) => {
        let data: SimpleSelector[] = [...sel.value].filter(n => n && !(n instanceof Nil));
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
        // Clear post on all components except the last one
        // Components in a compound selector are joined without spaces
        for (let i = 0; i < data.length - 1; i++) {
          (data[i] as any).post = undefined;
        }
        sel.setData([...data]);
        return sel;
      }
    );
  }

  /** @todo move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   this.data.forEach(node => node.toCSS(context, out))
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.sel([', this.location)
  //   const length = this.data.length - 1
  //   this.data.forEach((node, i) => {
  //     node.toModule(context, out)
  //     if (i < length) {
  //       out.add(', ')
  //     }
  //   })
  //   out.add('])')
  // }
}

export const compound = defineType(CompoundSelector, 'CompoundSelector', 'compound');