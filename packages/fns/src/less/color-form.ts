import { asNumber, defineForm, formNumber, knownUnit, type FormCall } from '@jesscss/core/form';
import { mulExact, percentToFraction, subExact } from '../util/decimal.js';
import { normalizeHue } from './color-ctor-helper.js';
import { isValueGroupArray, makeDimension, textOf, type Dimension, type Fn, type FunctionCall as WrittenCall, type Keyword, type Quoted, type ValueGroup } from '@jesscss/core/value';

/** A colour a form's relative colour reads as its origin, or what only the browser knows of one. */
export const COLOR_ARG = { type: ['Color', 'FunctionCall'], formUnits: [] } as const;

/** An amount in a channel, written as a number on that channel's scale, whatever its unit (css-color-5 §4.4). */
export const channelAmount = (amount: Dimension): Dimension => formNumber(amount.number);

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

/** Whether a method picks the form `method: relative` takes. */
function relativeMethod(name: string, method: Keyword | Quoted | WrittenCall | undefined): boolean {
  if (method?.type === 'FunctionCall') {
    throw new TypeError(`${name}: a method only the browser knows cannot pick a form`);
  }
  return method !== undefined && textOf(method) === 'relative';
}

/** `name(color, amount, method?)` over its CSS form, and the form `method: relative` takes; each with a form for an amount only the browser knows, taken to hold a percentage (Q2). */
/* @__NO_SIDE_EFFECTS__ */
export function defineAdjuster(name: string, absolute: FormCall[0], relative: FormCall[0], absoluteDeferred: FormCall[0], relativeDeferred: FormCall[0]): Fn {
  return defineForm(name, {
    params: [COLOR_ARG, { type: ['Dimension', 'FunctionCall'], formUnits: ['%'] }, { type: ['Keyword', 'Quoted', 'FunctionCall'], optional: true }],
    form: (color: ValueGroup, amount: Dimension | WrittenCall, method?: Keyword | Quoted | WrittenCall): FormCall => {
      const isRelative = relativeMethod(name, method);
      if (amount.type === 'Dimension') {
        return [isRelative ? relative : absolute, color, channelAmount(amount)];
      }
      const unit = knownUnit(amount);
      return unit === undefined || unit === '%'
        ? [isRelative ? relativeDeferred : absoluteDeferred, color, amount]
        : [isRelative ? relative : absolute, color, asNumber(amount, unit)];
    }
  });
}

/** `name(color, amount, method?)` for an amount of alpha, which has no form while only the browser knows it. */
/* @__NO_SIDE_EFFECTS__ */
export function defineAlphaAdjuster(name: string, absolute: FormCall[0], relative: FormCall[0]): Fn {
  return defineForm(name, {
    params: [COLOR_ARG, { type: 'Dimension' }, { type: ['Keyword', 'Quoted', 'FunctionCall'], optional: true }],
    form: (color: ValueGroup, amount: Dimension, method?: Keyword | Quoted | WrittenCall): FormCall =>
      [relativeMethod(name, method) ? relative : absolute, color, alphaAmount(amount)]
  });
}
