import { defineForm, type FormCall } from '@jesscss/core/form';
import { NoCssForm, RGB, colorRawRgb, isValueGroupArray, makeColorRgb, makeDimension, subExact, type Color, type Dimension, type Fn, type ValueGroup } from '@jesscss/core/value';
import { getLuma, reformatColor } from './color-helper.js';
import { COLOR_ARG } from './color-form.js';
import * as forms from './css-forms.generated.js';

const BLACK = /* @__PURE__ */ makeColorRgb([0, 0, 0], 1, RGB);
const WHITE = /* @__PURE__ */ makeColorRgb([255, 255, 255], 1, RGB);

/** WCAG 2.1 §1.4.3: the ratio of two relative luminances. */
const contrastRatio = (a: number, b: number): number =>
  a > b ? (a + 0.05) / (b + 0.05) : (b + 0.05) / (a + 0.05);

/** `rgb(from contrast-color(C) …)`: the result's red channel, 0 or 255, switches from `dark` to `light` (css-color-5 §8). */
function between(color: ValueGroup, dark: Color, light: Color): FormCall {
  const [dr, dg, db] = colorRawRgb(dark);
  const [lr, lg, lb] = colorRawRgb(light);
  const delta = (from: number, to: number): Dimension => makeDimension(subExact(to, from));
  return [
    forms.contrastBetween,
    color,
    makeDimension(dr), delta(dr, lr),
    makeDimension(dg), delta(dg, lg),
    makeDimension(db), delta(db, lb),
    makeDimension(dark.alpha), delta(dark.alpha, light.alpha)
  ];
}

const PARAMS = [COLOR_ARG, { type: 'Color', optional: true }, { type: 'Color', optional: true }, { type: 'Dimension', optional: true }] as const;

function picked(color: ValueGroup, givenDark?: Color, givenLight?: Color, threshold?: Dimension): FormCall | Color {
  const first = givenDark ?? BLACK;
  const second = givenLight ?? WHITE;
  const lumaFirst = givenDark === undefined ? 0 : getLuma(first);
  const lumaSecond = givenLight === undefined ? 1 : getLuma(second);
  const swapped = lumaFirst > lumaSecond;
  const dark = swapped ? second : first;
  const light = swapped ? first : second;
  if (isValueGroupArray(color) || color.type !== 'Color') {
    if (threshold !== undefined) {
      throw new NoCssForm('contrast: a threshold has no CSS form over a colour only the browser knows');
    }
    return givenDark === undefined && givenLight === undefined ? [forms.contrast, color] : between(color, dark, light);
  }
  const luma = getLuma(color);
  const lumaDark = swapped ? lumaSecond : lumaFirst;
  const lumaLight = swapped ? lumaFirst : lumaSecond;
  const picksLight = threshold === undefined
    ? contrastRatio(luma, lumaLight) >= contrastRatio(luma, lumaDark)
    : luma < (threshold.unit === '%' ? threshold.number / 100 : threshold.number);
  return reformatColor(picksLight ? light : dark, color.format);
}

/**
 * `contrast(color, dark = black, light = white, threshold?)`: a known `color`
 * picks `dark` or `light` by the larger WCAG 2.1 contrast ratio, or with a
 * `threshold` by whether its luma is below it (a `%` threshold is a fraction of
 * 1). Unknown, it is `contrast-color()`, whose algorithm is the browser's, so a
 * `threshold` has no form (docs/design/CSS-NATIVE-BUILTINS.md Q13). The two are
 * swapped if `dark` is the lighter, and the result takes `color`'s format.
 */
export const contrast: Fn = /* @__PURE__ */ defineForm('contrast', { params: PARAMS, form: picked, filter: true });
