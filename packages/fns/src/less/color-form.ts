import { asNumber, channelForm, defineForm, formMath, formNumber, isDimension, knownUnit, type FormCall, type FormSlot } from '@jesscss/core/form';
import { clamp01, fitsAny, inUnits, normalizeHue, percentOf } from './color-ctor-helper.js';
import { hsvBlack, hsvWhite, hsvWhiteKnown } from './css-forms.generated.js';
import { requireDimension } from '../shared/math/math-helper.js';
import { FunctionDeclined, isValueGroupArray, makeDimension, mulExact, percentToFraction, subExact, textOf, type Dimension, type Fn, type FunctionCall as WrittenCall, type Keyword, type Quoted, type ValueGroup } from '@jesscss/core/value';

/** A colour a form's relative colour reads as its origin, or what only the browser knows of one. */
export const COLOR_ARG = { type: ['Color', 'FunctionCall'], fits: (value: ValueGroup): boolean => inUnits(value, []) } as const;

/** An amount in a channel, written as a number on that channel's scale, whatever its unit (css-color-5 §4.4). */
export const channelAmount = (amount: Dimension): Dimension => formNumber(amount.number);

/** An amount of alpha, a number on 0–1 whatever its unit: `10%` and `10` alike are 0.1 (css-color-5 §4.1). */
export const alphaAmount = (amount: Dimension): Dimension => makeDimension(percentToFraction(amount.number));

/** What only the browser knows of an amount of alpha or a weight, on 0–1. Of no known type it is taken to hold a percentage (Q2). */
export function shareOf(amount: ValueGroup): ValueGroup {
  const unit = knownUnit(amount);
  return unit === undefined || unit === '%'
    ? formMath('/', amount, makeDimension(100, '%'))
    : formMath('/', asNumber(amount, unit), makeDimension(100));
}

export const HUE_UNITS: readonly string[] = ['', 'deg', 'grad', 'rad', 'turn'];

/** An amount or an S or V: whatever the known path reads there (§2). */
export const PERCENT_ARG = { type: ['Dimension', 'FunctionCall'], fits: fitsAny } as const;

/** A slot only the browser knows: a call of no known type, or of a number. */
export const isDeferredSlot = (value: ValueGroup): boolean =>
  !isValueGroupArray(value) && value.type === 'FunctionCall' && value.result !== 'color';

/** What CSS takes as an `rgb()` channel or an alpha (css-color-4 §4.2, §5.1). */
const CHANNEL_UNITS: readonly string[] = ['', '%'];

/** An alpha: whatever the known path reads there (§2). */
export const ALPHA_ARG = { type: ['Dimension', 'FunctionCall'], fits: fitsAny } as const;

/** A channel or an alpha as CSS holds it: a number in any other unit is that number. */
export function channelSlot(value: ValueGroup): ValueGroup {
  const unit = knownUnit(value);
  return unit === undefined || CHANNEL_UNITS.includes(unit)
    ? value
    : isDimension(value) ? makeDimension(value.number) : asNumber(value, unit);
}

/** A percentage channel as the number of 255 it is, as the compile reads it. */
const channelOf255 = (value: ValueGroup): ValueGroup =>
  isDimension(value) ? makeDimension(percentOf(value, 255)) : formMath('*', asNumber(value, '%'), makeDimension(2.55));

/**
 * A slot of `rgb()` as CSS holds it. The comma syntax takes three numbers or three
 * percentages (css-color-4 §5.1), so there a percentage beside a number is a number.
 */
export function rgbSlot(items: readonly ValueGroup[], modern: boolean): (value: ValueGroup, index: number) => ValueGroup {
  let number = false;
  let percent = false;
  for (let index = 0; index < 3; index++) {
    const unit = knownUnit(items[index]!);
    percent ||= unit === '%';
    number ||= unit !== undefined && unit !== '%';
  }
  return modern || !number || !percent
    ? channelSlot
    : (value, index) => index < 3 && knownUnit(value) === '%' ? channelOf255(value) : channelSlot(value);
}

/** An alpha on 0–1 while known; what only the browser knows goes in the slot as CSS holds it. */
export const alphaOf = (alpha: Dimension | WrittenCall): ValueGroup =>
  alpha.type === 'Dimension' ? makeDimension(clamp01(fractionOf(alpha))) : channelSlot(alpha);

/** S, V or L as CSS holds them: a percentage, which a number in any other unit is a fraction of 1 of, clamped to 0–1 as the compile reads it. */
export function percentSlot(value: ValueGroup): ValueGroup {
  const unit = knownUnit(value);
  return unit === undefined || unit === '%'
    ? value
    : isDimension(value) ? makeDimension(mulExact(clamp01(value.number), 100), '%') : formMath('*', asNumber(value, unit), makeDimension(100, '%'));
}

/** A hue, known or only the browser's; written as a call or in degrees. */
export const HUE_ARG = { type: ['Dimension', 'FunctionCall'], fits: fitsAny } as const;

/** A hue as CSS holds it: a percentage of a turn, and a number in any unit that is no angle. */
export function hueSlot(hue: ValueGroup): ValueGroup {
  const unit = knownUnit(hue);
  if (unit === undefined || HUE_UNITS.includes(unit.toLowerCase())) {
    return hue;
  }
  return isDimension(hue)
    ? makeDimension(normalizeHue(hue))
    : unit === '%' ? formMath('*', asNumber(hue, unit), makeDimension(3.6)) : asNumber(hue, unit);
}

/** A hue in degrees, which a known unit converts to. What only the browser knows goes in the slot as CSS holds it. */
export const hueOf = (hue: ValueGroup): ValueGroup =>
  isDimension(hue) ? makeDimension(normalizeHue(hue)) : hueSlot(hue);

/** `rgb()` or `hsl()` over what only the browser knows is CSS as written, each slot as CSS holds it. */
export function declineSlots(items: readonly ValueGroup[], slot: (value: ValueGroup, index: number) => ValueGroup): never {
  const written = items.map((item, index) => slot(isDeferredSlot(item) ? item : requireDimension(item), index));
  throw new FunctionDeclined(written, written.some((value, index) => value !== items[index]));
}

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
export function whiteBlack(s: Dimension | WrittenCall, v: Dimension | WrittenCall): readonly [white: FormSlot, black: FormSlot] {
  if (s.type === 'Dimension' && v.type === 'Dimension') {
    return knownWhiteBlack(s, v);
  }
  const value = v.type === 'Dimension' ? makeDimension(onHundred(v), '%') : percentSlot(v);
  return [
    s.type === 'Dimension'
      ? channelForm(hsvWhiteKnown, makeDimension(percentToFraction(subExact(100, onHundred(s)))), value)
      : channelForm(hsvWhite, percentSlot(s), value),
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

/** `name(color, amount, method?)` over its CSS form, and the form `method: relative` takes. An amount only the browser knows is its number, of no known type taken to hold a percentage (Q2). */
/* @__NO_SIDE_EFFECTS__ */
export function defineAdjuster(name: string, absolute: FormCall[0], relative: FormCall[0]): Fn {
  return defineForm(name, {
    params: [COLOR_ARG, PERCENT_ARG, { type: ['Keyword', 'Quoted', 'FunctionCall'], optional: true }],
    form: (color: ValueGroup, amount: Dimension | WrittenCall, method?: Keyword | Quoted | WrittenCall): FormCall =>
      [relativeMethod(name, method) ? relative : absolute, color, amount.type === 'Dimension' ? channelAmount(amount) : asNumber(amount, knownUnit(amount) ?? '%')]
  });
}

/** `name(color, amount, method?)` for an amount of alpha, which only the browser knows is its share of 100. */
/* @__NO_SIDE_EFFECTS__ */
export function defineAlphaAdjuster(name: string, absolute: FormCall[0], relative: FormCall[0]): Fn {
  return defineForm(name, {
    params: [COLOR_ARG, PERCENT_ARG, { type: ['Keyword', 'Quoted', 'FunctionCall'], optional: true }],
    form: (color: ValueGroup, amount: Dimension | WrittenCall, method?: Keyword | Quoted | WrittenCall): FormCall =>
      [relativeMethod(name, method) ? relative : absolute, color, amount.type === 'Dimension' ? alphaAmount(amount) : shareOf(amount)]
  });
}
