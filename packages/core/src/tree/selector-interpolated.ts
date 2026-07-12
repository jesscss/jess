import type { Context } from '../context.js';
import { defineType } from './node.js';
import { SimpleSelector } from './selector-simple.js';
import { attachSelectorBitLibrary, Selector } from './selector.js';
import { Interpolated } from './interpolated.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';

export interface InterpolatedSelector extends SimpleSelector<Interpolated> {
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
    const { selectorBits } = context;
    this.keySetLibrary ??= selectorBits;
    const out = this.value.evalToSelector(context);
    if (isThenable(out)) {
      return (out as Promise<Selector>).then((selector) => attachSelectorBitLibrary(selector, selectorBits));
    }
    return attachSelectorBitLibrary(out as Selector, selectorBits);
  }

  override valueOf(): string {
    return this.value.valueOf();
  }
}

export const interpolatedSelector = defineType(InterpolatedSelector, 'InterpolatedSelector', 'interpolated-selector');
