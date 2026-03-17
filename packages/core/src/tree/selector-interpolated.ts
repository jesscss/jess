import type { Context } from '../context.js';
import { defineType } from './node.js';
import { SimpleSelector } from './selector-simple.js';
import { Selector } from './selector.js';
import type { BitSetLibrary } from './util/bitset.js';
import { Interpolated } from './interpolated.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';

const { isArray } = Array;

function propagateKeySetLibrary(sel: Selector, library: BitSetLibrary<string>) {
  sel.keySetLibrary = library;
  let data = sel.data;
  if (isArray(data)) {
    for (const child of data as Selector[]) {
      if (!child.keySetLibrary) {
        propagateKeySetLibrary(child, library);
      }
    }
  }
}

export interface InterpolatedSelector extends SimpleSelector<Interpolated> {
  type: 'InterpolatedSelector';
  shortType: 'interpolated-selector';
  eval(context: Context): MaybePromise<Selector>;
}

/**
 * A selector that wraps an interpolated value
 * This allows interpolation to be used in selector contexts
 */
export class InterpolatedSelector extends SimpleSelector<Interpolated> {
  get isClass() {
    return /^\./.test(this.valueOf());
  }

  get isId() {
    return /^#/.test(this.valueOf());
  }

  get isTag() {
    return /^[^.#*]/.test(this.valueOf());
  }

  override evalNode(context: Context): MaybePromise<Selector> {
    const result = this.data.evalToSelector(context);
    const library = context.selectorBits;
    if (isThenable(result)) {
      return (result as Promise<Selector>).then((sel) => {
        propagateKeySetLibrary(sel, library);
        return sel;
      });
    }
    propagateKeySetLibrary(result as Selector, library);
    return result;
  }

  override valueOf(): string {
    return this.data.valueOf();
  }
}

export const interpolatedSelector = defineType(InterpolatedSelector, 'InterpolatedSelector', 'interpolated-selector');
