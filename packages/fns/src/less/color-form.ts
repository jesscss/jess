import { asNumber, channelForm, defineForm, formNumber, knownUnit, type FormCall, type FormSlot } from '@jesscss/core/form';
import { clamp01, inUnits, normalizeHue } from './color-ctor-helper.js';
import { hsvBlack, hsvWhite, hsvWhiteKnown } from './css-forms.generated.js';
import { isValueGroupArray, makeDimension, mulExact, percentToFraction, subExact, textOf, type Dimension, type Fn, type FunctionCall as WrittenCall, type Keyword, type Quoted, type ValueGroup } from '@jesscss/core/value';

/** A colour a form's relative colour reads as its origin, or what only the browser knows of one. */
export const COLOR_ARG = { type: ['Color', 'FunctionCall'], fits: (value: ValueGroup): boolean => inUnits(value, []) } as const;

/** An amount in a channel, written as a number on that channel's scale, whatever its unit (css-color-5 §4.4). */
export const channelAmount = (amount: Dimension): Dimension => formNumber(amount.number);

/** An amount of alpha, a number on 0–1 whatever its unit: `10%` and `10` alike are 0.1 (css-color-5 §4.1). */
export const alphaAmount = (amount: Dimension): Dimension => makeDimension(percentToFraction(amount.number));

export const HUE_UNITS: readonly string[] = ['', 'deg', 'grad', 'rad', 'turn'];

const fitsPercent = (value: ValueGroup): boolean => inUnits(value, ['%']);

/** An amount or an S or V: a number on its own scale while known, and a percentage while only the browser knows it (Q2). */
export const PERCENT_ARG = { type: ['Dimension', 'FunctionCall'], fits: fitsPercent } as const;

/** A slot only the browser knows: a call of no known type, or of a number. */
export const isDeferredSlot = (value: ValueGroup): boolean =>
  !isValueGroupArray(value) && value.type === 'FunctionCall' && value.result !== 'color';

/** What CSS takes as an `rgb()` channel or an alpha (css-color-4 §4.2, §5.1). */
export const CHANNEL_UNITS: readonly string[] = ['', '%'];

/** An alpha, read as written. */
export const ALPHA_ARG = { type: ['Dimension', 'FunctionCall'], fits: (value: ValueGroup): boolean => inUnits(value, CHANNEL_UNITS) } as const;

/** An alpha on 0–1 while known; what only the browser knows goes in the slot as it is, and math of another type has no form. */
export function alphaOf(name: string, alpha: Dimension | WrittenCall): Dimension | WrittenCall {
  if (alpha.type === 'Dimension') {
    return makeDimension(clamp01(fractionOf(alpha)));
  }
  const unit = knownUnit(alpha);
  if (unit !== undefined && !CHANNEL_UNITS.includes(unit)) {
    throw new TypeError(`${name}: an alpha is a number or a percentage`);
  }
  return alpha;
}

/** What only the browser knows of a slot that takes a percentage; math of another type has no form. */
export function deferredPercent(name: string, value: WrittenCall): WrittenCall {
  const unit = knownUnit(value);
  if (unit !== undefined && unit !== '%') {
    throw new TypeError(`${name}: only a percentage has a form while the browser holds the value`);
  }
  return value;
}

/** A hue, known or only the browser's; written as a call or in degrees. */
export const HUE_ARG = { type: ['Dimension', 'FunctionCall'], fits: (value: ValueGroup): boolean => inUnits(value, HUE_UNITS) } as const;

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
function knownWhiteBlack(s: Dimension, v: Dimension): readonly [white: Dimension, black: Dimension] {
  const saturation = onHundred(s);
  const value = onHundred(v);
  const product = (100 - saturation) * value;
  return Number.isSafeInteger(saturation) && Number.isSafeInteger(value) && Number.isSafeInteger(product)
    ? [makeDimension(product / 100, '%'), makeDimension(100 - value, '%')]
    : [makeDimension(percentToFraction(mulExact(subExact(100, saturation), value)), '%'), makeDimension(subExact(100, value), '%')];
}

/** White and black as slots of `hwb()`, computed for what is known, and as `calc()` over a percentage only the browser knows (Q2). */
export function whiteBlack(name: string, s: Dimension | WrittenCall, v: Dimension | WrittenCall): readonly [white: FormSlot, black: FormSlot] {
  if (s.type === 'Dimension' && v.type === 'Dimension') {
    return knownWhiteBlack(s, v);
  }
  const value = v.type === 'Dimension' ? makeDimension(onHundred(v), '%') : deferredPercent(name, v);
  return [
    s.type === 'Dimension'
      ? channelForm(hsvWhiteKnown, makeDimension(percentToFraction(subExact(100, onHundred(s)))), value)
      : channelForm(hsvWhite, deferredPercent(name, s), value),
    v.type === 'Dimension' ? makeDimension(subExact(100, onHundred(v)), '%') : channelForm(hsvBlack, value)
  ];
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
    params: [COLOR_ARG, PERCENT_ARG, { type: ['Keyword', 'Quoted', 'FunctionCall'], optional: true }],
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

/** `name(color, amount, method?)` for an amount of alpha, with a form for an amount only the browser knows, taken to hold a percentage (Q2). */
/* @__NO_SIDE_EFFECTS__ */
export function defineAlphaAdjuster(name: string, absolute: FormCall[0], relative: FormCall[0], absoluteDeferred: FormCall[0], relativeDeferred: FormCall[0]): Fn {
  return defineForm(name, {
    params: [COLOR_ARG, PERCENT_ARG, { type: ['Keyword', 'Quoted', 'FunctionCall'], optional: true }],
    form: (color: ValueGroup, amount: Dimension | WrittenCall, method?: Keyword | Quoted | WrittenCall): FormCall => {
      const isRelative = relativeMethod(name, method);
      return amount.type === 'Dimension'
        ? [isRelative ? relative : absolute, color, alphaAmount(amount)]
        : [isRelative ? relativeDeferred : absoluteDeferred, color, deferredPercent(name, amount)];
    }
  });
}
