import {
  defineType
} from './node.js';
import type { Context } from '../context.js';
import { Nil } from './nil.js';
import { Selector } from './selector.js';
import type { SimpleSelector } from './selector-simple.js';
import { getEntries } from './util/collections.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import type { PrintOptions } from './util/print.js';

/**
 * @example
 * .class#id
 *
 * Must have at least 2 selectors. Otherwise it would be collapsed.
 */
/** Anything other than type (element) or universal, which must come first */
const nonElementRegex = /^[.#:[]/;
export class CompoundSelector extends Selector<SimpleSelector[]> {
  type = 'CompoundSelector' as const;
  shortType = 'compound' as const;

  protected override _computeKeySetAndFastReject(): void {
    let combinedKeySet = new Set<string>();
    let combinedVisibleKeySet = new Set<string>();
    let canFastReject = true;

    for (const selector of this.value) {
      // Union each child's keySet
      combinedKeySet = combinedKeySet.union(selector.keySet);
      combinedVisibleKeySet = combinedVisibleKeySet.union(selector.visibleKeySet);
      // If any child can't fast reject, this compound can't either
      if (!selector.canFastReject) {
        canFastReject = false;
      }
    }

    this._keySet = combinedKeySet;
    this._visibleKeySet = combinedVisibleKeySet;
    this._canFastReject = canFastReject;
  }

  override valueOf() {
    let value = this._valueOf;
    if (!value) {
      // Convert selectors to strings
      const components = this.value.map(n => n.valueOf());

      // Find element selectors (those that don't start with .#:[)
      const elementSelectors: string[] = [];
      const nonElementSelectors: string[] = [];

      for (const component of components) {
        if (!nonElementRegex.test(component)) {
          elementSelectors.push(component);
        } else {
          nonElementSelectors.push(component);
        }
      }

      // Element selectors must come first for valid CSS
      // Non-element selectors maintain their original order (no sorting)
      value = [...elementSelectors, ...nonElementSelectors].join('');
      this._valueOf = value;
    }
    return value;
  }

  override toTrimmedString(options?: PrintOptions): string {
    // Call base implementation which calls toString() on each component
    return super.toTrimmedString(options);
  }

  override evalNode(context: Context): MaybePromise<CompoundSelector | Selector | Nil> {
    return pipe(
      () => {
        const sel = this;
        let { value } = sel;
        const maybe = serialForEach(Array.from(getEntries(value)), ([item, i]) => {
          const out = item.eval(context);
          if (isThenable(out)) {
            return (out as Promise<SimpleSelector>).then((res) => {
              value[i] = res as SimpleSelector;
              return undefined;
            });
          }
          value[i] = out as SimpleSelector;
          return undefined;
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => sel);
        }
        return sel;
      },
      (sel) => {
        let { value } = sel;
        value = value
          .filter(n => n && !(n instanceof Nil))
          .sort((a, b) => {
            let aIsElement = !nonElementRegex.test(a.valueOf());
            let bIsElement = !nonElementRegex.test(b.valueOf());
            if (aIsElement && bIsElement) {
              return a.valueOf() < b.valueOf() ? -1 : 1;
            }
            return aIsElement ? -1 : bIsElement ? 1 : 0;
          });
        if (value.length === 0) {
          return (new Nil()).inherit(this);
        }
        if (value.length === 1) {
          return value[0]!.inherit(this) as Selector;
        }
        // Clear post on all components except the last one
        // Components in a compound selector are joined without spaces
        for (let i = 0; i < value.length - 1; i++) {
          (value[i] as any).post = undefined;
        }
        sel.value = value;
        return sel;
      }
    );
  }

  /** @todo move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   this.value.forEach(node => node.toCSS(context, out))
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.sel([', this.location)
  //   const length = this.value.length - 1
  //   this.value.forEach((node, i) => {
  //     node.toModule(context, out)
  //     if (i < length) {
  //       out.add(', ')
  //     }
  //   })
  //   out.add('])')
  // }
}

export const compound = defineType(CompoundSelector, 'CompoundSelector', 'compound');