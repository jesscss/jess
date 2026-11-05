import { NoCssForm, colorRawRgb, holdsNone, isValueGroupArray, makeDimension, type Color, type Dimension, type FunctionCall as WrittenCall, type ValueGroup } from '@jesscss/core/value';
import type { FormCall } from '@jesscss/core/form';
import * as forms from './css-forms.generated.js';
import { mulExact, percentToFraction, subExact } from '../util/decimal.js';

/** What `color-mix()` holds as a weight (css-color-5 §3.2). */
const inRange = (weight: number): boolean => weight >= 0 && weight <= 100;

/** A mix's weight: a number in any unit is a percentage, and what only the browser knows is taken to hold one (§3.4a). */
export const WEIGHT_ARG = {
  type: ['Dimension', 'FunctionCall'],
  optional: true,
  fits: (value: ValueGroup): boolean => !isValueGroupArray(value) && value.type === 'Dimension' && value.unit === '%' && inRange(value.number)
} as const;

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

/** A mix toward a colour the form names (`white`, `black`), `amount` of it. */
export function towardKnown(form: FormCall[0], color: ValueGroup, amount: Weight | undefined, other: () => Color): FormCall {
  const weight = amount ?? makeDimension(50, '%');
  return weight.type === 'Dimension' && !inRange(weight.number) && !isKnown(color)
    ? mixOver(color, subExact(100, weight.number), other())
    : [form, color, percentOf(weight)];
}

/** `mix(a, b, weight)`'s form: `color-mix()`, or the relative form over the colour not known, or none when neither is. */
export function mixForm(a: ValueGroup, b: ValueGroup, weight: Weight): FormCall {
  if (weight.type !== 'Dimension' || inRange(weight.number) || (isKnown(a) && isKnown(b))) {
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
