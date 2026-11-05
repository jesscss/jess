import { defineForm, type FormCall } from '@jesscss/core/form';
import { mulExact, percentToFraction, subExact } from '../util/decimal.js';
import { normalizeHue } from './color-ctor-helper.js';
import { isValueGroupArray, makeDimension, textOf, type Dimension, type Fn, type FunctionCall as WrittenCall, type Keyword, type Quoted, type ValueGroup } from '@jesscss/core/value';

/** A colour a form's relative colour reads as its origin, or what only the browser knows of one. */
export const COLOR_ARG = { type: ['Color', 'FunctionCall'] } as const;

/** An amount in a channel, written as a number on that channel's scale, whatever its unit (css-color-5 §4.4). */
export const channelAmount = (amount: Dimension): Dimension => makeDimension(amount.number);

/** An amount of alpha, a number on 0–1 whatever its unit: `10%` and `10` alike are 0.1 (css-color-5 §4.1). */
export const alphaAmount = (amount: Dimension): Dimension => makeDimension(percentToFraction(amount.number));

/** A hue, known or only the browser's; written as a call or in degrees. */
export const HUE_ARG = { type: ['Dimension', 'FunctionCall'], formUnits: ['', 'deg', 'grad', 'rad', 'turn'] } as const;

/** A hue in degrees, which a known unit converts to. What only the browser knows stays as it is. */
export const hueOf = (hue: ValueGroup): ValueGroup =>
  !isValueGroupArray(hue) && hue.type === 'Dimension' ? makeDimension(normalizeHue(hue)) : hue;

/** A value on 0–1: a percentage of 1, or a number as written. */
export const fractionOf = (value: Dimension): number =>
  value.unit === '%' ? percentToFraction(value.number) : value.number;

/** S or V on 0–100: an authored percentage's own number, or a 0–1 number scaled. */
const onHundred = (value: Dimension): number => value.unit === '%' ? value.number : mulExact(value.number, 100);

/**
 * `hsv`'s S and V as `hwb()` reads them: white `(1 - s)v`, black `1 - v`, exactly,
 * in percent. Whole numbers whose product a double holds are exact without the
 * decimal path, which costs 13% of a stylesheet of them.
 */
export function whiteBlack(s: Dimension, v: Dimension): readonly [white: Dimension, black: Dimension] {
  const saturation = onHundred(s);
  const value = onHundred(v);
  const product = (100 - saturation) * value;
  return Number.isSafeInteger(saturation) && Number.isSafeInteger(value) && Number.isSafeInteger(product)
    ? [makeDimension(product / 100, '%'), makeDimension(100 - value, '%')]
    : [makeDimension(percentToFraction(mulExact(subExact(100, saturation), value)), '%'), makeDimension(subExact(100, value), '%')];
}

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
