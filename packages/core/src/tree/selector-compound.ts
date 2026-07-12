import {
  defineType
} from './node';
import type { Context } from '../context';
import { Nil } from './nil';
import { Selector } from './selector';
import type { SimpleSelector } from './selector-simple';
import { getEntries } from './util/collections';

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

  get keySet() {
    if (this._keySet === undefined) {
      this._computeKeySetAndFastReject();
    }
    return this._keySet!;
  }

  protected override _computeKeySetAndFastReject(): void {
    let combinedKeySet = new Set<string>();
    let canFastReject = true;

    for (const selector of this.value) {
      // Union each child's keySet
      combinedKeySet = combinedKeySet.union(selector.keySet);
      // If any child can't fast reject, this compound can't either
      if (!selector.canFastReject) {
        canFastReject = false;
      }
    }

    this._keySet = combinedKeySet;
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

  override async evalNode(context: Context): Promise<CompoundSelector | Selector | Nil> {
    const sel = this.maybeClone(context);
    let { value } = sel;
    for (let [item, i] of getEntries(value)) {
      value[i] = await item.eval(context) as SimpleSelector;
    }
    /** Bubble tag selectors to the front of compound selectors */
    value = value
      .filter(n => n && !(n instanceof Nil))
      .sort((a, b) => {
        let aIsElement = !nonElementRegex.test(a.valueOf());
        let bIsElement = !nonElementRegex.test(b.valueOf());
        if (aIsElement && bIsElement) {
          /** Throw an error? */
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
    sel.value = value;
    return sel;
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