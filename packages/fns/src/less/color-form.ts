import { defineForm, type FormCall } from '@jesscss/core/form';
import { percentToFraction } from '../util/decimal.js';
import { makeDimension, textOf, type Dimension, type Fn, type FunctionCall as WrittenCall, type Keyword, type Quoted, type ValueGroup } from '@jesscss/core/value';

/** A colour a form's relative colour reads as its origin, or what only the browser knows of one. */
export const COLOR_ARG = { type: ['Color', 'FunctionCall'] } as const;

/** An amount in a channel, written as a number on that channel's scale, whatever its unit (css-color-5 §4.4). */
export const channelAmount = (amount: Dimension): Dimension => makeDimension(amount.number);

/** An amount of alpha, a number on 0–1 whatever its unit: `10%` and `10` alike are 0.1 (css-color-5 §4.1). */
export const alphaAmount = (amount: Dimension): Dimension => makeDimension(percentToFraction(amount.number));

/** A value on 0–1: a percentage of 1, or a number as written. */
export const fractionOf = (value: Dimension): Dimension =>
  value.unit === '%' ? makeDimension(percentToFraction(value.number)) : makeDimension(value.number);

/** `name(color, amount, method?)` over its CSS form, and the form `method: relative` takes. */
/* @__NO_SIDE_EFFECTS__ */
export function defineAdjuster(name: string, absolute: FormCall[0], relative: FormCall[0], amountOf: (amount: Dimension) => Dimension = channelAmount): Fn {
  return defineForm(name, {
    params: [COLOR_ARG, { type: 'Dimension' }, { type: ['Keyword', 'Quoted', 'FunctionCall'], optional: true }],
    form: (color: ValueGroup, amount: Dimension, method?: Keyword | Quoted | WrittenCall): FormCall => {
      if (method?.type === 'FunctionCall') {
        throw new TypeError(`${name}: a method only the browser knows cannot pick a form`);
      }
      return [method !== undefined && textOf(method) === 'relative' ? relative : absolute, color, amountOf(amount)];
    }
  });
}
