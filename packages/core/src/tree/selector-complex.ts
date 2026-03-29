import { type Combinator } from './combinator.js';
import { type Ampersand, Ampersand as AmpersandClass } from './ampersand.js';
import {
  defineType,
  F_VISIBLE,
  F_IMPLICIT_AMPERSAND
} from './node.js';
import type { Context } from '../context.js';
import { type Nil } from './nil.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { Selector } from './selector.js';
import type { SimpleSelector } from './selector-simple.js';
import type { CompoundSelector } from './selector-compound.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import { getField, setField } from './util/field-helpers.js';

// TODO - fix later
export type ComplexSelectorComponent = SimpleSelector | CompoundSelector | Combinator | Ampersand;
// type SelectorValue = Component[]
export type ComplexSelectorValue = ComplexSelectorComponent[];

export type ComplexSelectorChildData = { value: ComplexSelectorValue };

/**
 * Selectors with combinators.
 *
 * @example
 * #id > .class.class
 *
 * @note A complex selector may not always start with a selector. We also use this for a
 * relative selector, which means it may start with a combinator.
 */
export interface ComplexSelector {
  type: 'ComplexSelector';
  shortType: 'sel';
}
export class ComplexSelector extends Selector<ComplexSelectorValue, any, ComplexSelectorChildData> {
  static override childKeys = ['value'] as const;

  /** @internal */ _value!: ComplexSelectorValue;

  constructor(value: ComplexSelectorValue, options?: any, location?: any, treeContext?: any) {
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

  override valueOf() {
    const value = Array.isArray(this._value)
      ? this._value
      : [this._value as unknown as ComplexSelectorComponent];
    return (this._valueOf ??= value.map(n => n.valueOf()).join(''));
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const value = this.get('value', options.context);
    let length = value.length;
    const mark = w.mark();
    for (let i = 0; i < length; i++) {
      let component = value[i]!;
      /** Add some combinator spacing */
      if (isNode(component, N.Combinator)) {
        /** Skip spacing if the previous node is a Nil */
        if (isNode(value[i - 1], N.Nil)) {
          continue;
        }
        let co = component._value;
        if (co !== ' ') {
          let out = w.capture(() => component.toString(options));
          if (out !== '|') {
            w.add(` ${out.trim()} `, component);
          } else {
            w.add(out.trim(), component);
          }
        } else {
          let out = w.capture(() => component.toString(options));
          w.add(` ${out.trim()}`, component);
        }
      } else {
        let out = w.capture(() => component.toString(options));
        w.add(out.trim(), component);
      }
    }
    return w.getSince(mark);
  }

  override evalNode(context: Context): MaybePromise<Selector | Nil> {
    return pipe(
      () => {
        const selector = super.evalNode(context) as ComplexSelector;
        const value = [...selector.get('value', context)];
        let changed = false;
        const maybe = serialForEach(value.map((_, i) => i), (i: number) => {
          const out = value[i]!.eval(context);
          if (isThenable(out)) {
            return (out as Promise<Selector | Nil>).then((res) => {
              if (res !== value[i]) {
                value[i] = res as ComplexSelectorComponent;
                changed = true;
              }
              return undefined;
            });
          }
          if ((out as ComplexSelectorComponent) !== value[i]) {
            value[i] = out as ComplexSelectorComponent;
            changed = true;
          }
          return undefined;
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => {
            if (changed) {
              setField(selector, 'value', value, context);
            }
            return selector;
          });
        }
        if (changed) {
          setField(selector, 'value', value, context);
        }
        return selector;
      },
      (selector) => {
        const value = selector.get('value', context);
        if (value.length === 1) {
          const originalOnly = value[0]!;
          const only = originalOnly.clone(false, undefined, context);
          only.inherit(selector);
          if (getField<boolean | undefined>(selector, 'hoistToRoot', context) || only.hoistToRoot) {
            setField(only, 'hoistToRoot', true, context);
          }
          return only;
        }
        return selector;
      }
    );
  }
}

type SelectorParams = ConstructorParameters<typeof ComplexSelector>;

export const sel = defineType<ComplexSelectorValue>(ComplexSelector, 'ComplexSelector', 'sel') as (
  value: ComplexSelectorValue,
  options?: SelectorParams[1],
  location?: SelectorParams[2],
  treeContext?: SelectorParams[3]
) => ComplexSelector;
