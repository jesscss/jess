import type { Context } from '../context.js';
import { defineType } from './node.js';
import { SimpleSelector } from './selector-simple.js';
import { Selector } from './selector.js';
import { Interpolated } from './interpolated.js';
import { type MaybePromise } from '@jesscss/awaitable-pipe';

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
    return this.value.evalToSelector(context);
  }

  override valueOf(): string {
    return this.value.valueOf();
  }
}

export const interpolatedSelector = defineType(InterpolatedSelector, 'InterpolatedSelector', 'interpolated-selector');
