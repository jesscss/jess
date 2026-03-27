import type { Context } from '../context.js';
import { defineType, Node, type OptionalLocation, type NodeOptions, type TreeContext } from './node.js';
import { SimpleSelector } from './selector-simple.js';
import { Selector } from './selector.js';
import type { BitSetLibrary } from './util/bitset.js';
import { Interpolated } from './interpolated.js';
import { getPrintOptions, type PrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { getField } from './util/field-helpers.js';

const { isArray } = Array;

function propagateKeySetLibrary(sel: Selector, library: BitSetLibrary<string>) {
  sel.keySetLibrary = library;
  const childKeys = (sel.constructor as typeof Node).childKeys;
  if (!childKeys) {
    return;
  }
  for (const key of childKeys) {
    const field = (sel as unknown as Record<string, unknown>)[key];
    if (isArray(field)) {
      for (const child of field as Selector[]) {
        if (child && !child.keySetLibrary) {
          propagateKeySetLibrary(child, library);
        }
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
  static override childKeys = ['value'] as const;

  value!: Interpolated;

  constructor(value: Interpolated, options?: NodeOptions, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.value = value;
    if (this.value instanceof Node) {
      this.adopt(this.value);
    }
  }

  private _getValue(context?: Context): Interpolated {
    return context
      ? getField<Interpolated>(this, 'value', context)
      : this.value;
  }

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
    const result = this._getValue(context).evalToSelector(context);
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

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    this._getValue(options.context).toString(options);
    return w.getSince(mark);
  }

  override valueOf(): string {
    return this.value.valueOf();
  }
}

export const interpolatedSelector = defineType(InterpolatedSelector, 'InterpolatedSelector', 'interpolated-selector');
