import { NoCssForm, colorRawRgb, groupItems, holdsNone, isValueGroupArray, makeDimension, mulExact, percentToFraction, subExact, checkKinds, type Color, type Dimension, type FunctionCall as WrittenCall, type ValueGroup, optional } from '@jesscss/core/value';
import { asNumber, formMath, isDimension, knownUnit, type FormCall } from '@jesscss/core/form';
import { fitsAny } from './color-ctor-helper.js';
import { shareOf } from './color-form.js';
import * as forms from './css-forms.generated.js';

/** What `color-mix()` holds as a weight (css-color-5 §3.2). */
const inRange = (weight: number): boolean => weight >= 0 && weight <= 100;

/** A mix's weight: a number in any unit is a percentage, and what only the browser knows is taken to hold one (§3.4a). */
export const WEIGHT_ARG = /* @__PURE__ */ optional({ type: ['Dimension', 'FunctionCall'], check: checkKinds, fits: fitsAny });

export type Weight = Dimension | WrittenCall;

const isColor = (value: ValueGroup): value is Color => !isValueGroupArray(value) && value.type === 'Color';

export const isKnown = (value: ValueGroup): value is Color => isColor(value) && !holdsNone(value);

/** A weight as `color-mix()` writes it. */
export const percentOf = (weight: Weight): Weight =>
  weight.type !== 'Dimension' || weight.unit === '%' ? weight : makeDimension(weight.number, '%');

/**
 * The relative form of a mix `color-mix()` cannot hold (§3.4a, rung 3), exact
 * for every weight because the other colour is known: `color` counts `weight`
 * percent, `known` the rest, each by its opacity (css-color-5 §3.5).
 */
export function mixOver(color: ValueGroup, weight: number, known: Color): FormCall {
  const share = mulExact(Math.min(Math.max(known.alpha, 0), 1), percentToFraction(subExact(100, weight)));
  const [r, g, b] = colorRawRgb(known);
  const premultiplied = (channel: number): Dimension => makeDimension(mulExact(Math.min(Math.max(channel, 0), 255), share));
  return [forms.mixOver, color, makeDimension(percentToFraction(weight)), premultiplied(r), premultiplied(g), premultiplied(b), makeDimension(share)];
}

/** {@link mixOver} over a weight only the browser knows, in a known unit: `share` of `color`, `rest` of `known`. Exact for every weight, which `color-mix()` is not. */
function mixOverDeferred(color: ValueGroup, share: ValueGroup, rest: ValueGroup, known: Color): FormCall {
  const opacity = Math.min(Math.max(known.alpha, 0), 1);
  const [r, g, b] = colorRawRgb(known);
  const premultiplied = (channel: number): ValueGroup => formMath('*', makeDimension(mulExact(Math.min(Math.max(channel, 0), 255), opacity)), rest);
  return [forms.mixOver, color, share, premultiplied(r), premultiplied(g), premultiplied(b), formMath('*', makeDimension(opacity), rest)];
}

const restOf = (share: ValueGroup): ValueGroup => formMath('-', makeDimension(1), share);

/** A mix toward a colour the form names (`white`, `black`), `amount` of it. */
export function towardKnown(form: FormCall[0], color: ValueGroup, amount: Weight | undefined, other: () => Color): FormCall {
  const weight = amount ?? makeDimension(50, '%');
  if (weight.type !== 'Dimension' && knownUnit(weight) !== undefined) {
    const share = shareOf(weight);
    return mixOverDeferred(color, restOf(share), share, other());
  }
  return weight.type === 'Dimension' && !inRange(weight.number) && !isKnown(color)
    ? mixOver(color, subExact(100, weight.number), other())
    : [form, color, percentOf(weight)];
}

/** A weight between two colours only the browser knows, as `color-mix()` holds it: a percentage in its range, or there is no form. */
function heldWeight(weight: WrittenCall, unit: string): ValueGroup {
  const held = weight.name === 'var' ? groupItems(weight.args)[1] : undefined;
  if (isDimension(held) && !inRange(held.number)) {
    throw new NoCssForm(`mix: no CSS form holds a weight of ${held.number}% between two colours only the browser knows`);
  }
  return unit === '%' ? weight : formMath('*', asNumber(weight, unit), makeDimension(1, '%'));
}

/** `mix(a, b, weight)`'s form: `color-mix()`, or the relative form over the colour not known, or none when neither is. */
export function mixForm(a: ValueGroup, b: ValueGroup, weight: Weight): FormCall {
  if (weight.type !== 'Dimension') {
    const unit = knownUnit(weight);
    if (unit === undefined) {
      return [forms.mix, a, weight, b];
    }
    const share = shareOf(weight);
    if (isColor(b)) {
      return mixOverDeferred(a, share, restOf(share), b);
    }
    return isColor(a)
      ? mixOverDeferred(b, restOf(share), share, a)
      : [forms.mix, a, heldWeight(weight, unit), b];
  }
  if (inRange(weight.number) || (isKnown(a) && isKnown(b))) {
    return [forms.mix, a, percentOf(weight), b];
  }

  /* No form keeps `none` beyond the range: it reads as 0, as the browser reads it in the origin. */
  if (isColor(b)) {
    return mixOver(a, weight.number, b);
  }
  if (isColor(a)) {
    return mixOver(b, subExact(100, weight.number), a);
  }
  throw new NoCssForm(`mix: no CSS form holds a weight of ${weight.number}% between two colours only the browser knows`);
}
