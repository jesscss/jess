import { defineForm, type FormCall } from '@jesscss/core/form';
import { RGB, colorRawRgb, isValueGroupArray, makeColorRgb, makeDimension, subExact, checkColor, checkDimension, type Color, type Dimension, type Fn, type ValueGroup, optional } from '@jesscss/core/value';
import { getLuma, reformatColor } from './color-helper.js';
import { COLOR_ARG } from './color-form.js';
import * as forms from './css-forms.generated.js';

const BLACK = /* @__PURE__ */ makeColorRgb([0, 0, 0], 1, RGB);
const WHITE = /* @__PURE__ */ makeColorRgb([255, 255, 255], 1, RGB);

/** WCAG 2.1 §1.4.3: the ratio of two relative luminances. */
const contrastRatio = (a: number, b: number): number =>
  a > b ? (a + 0.05) / (b + 0.05) : (b + 0.05) / (a + 0.05);

/** A channel 0–255 in linear light, as `srgb-linear` reads it (css-color-4 §10.2). */
const linear = (c: number): number => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};

/**
 * `color(from C srgb-linear …)`: each channel of `dark`, moved to `light`'s by a
 * step of 0 or 1 that compares `C`'s luminance with `t` (V40): at or below the
 * switch point for the contrast ratio, below the threshold for a `threshold`.
 */
function between(color: ValueGroup, t: number, dark: Color, light: Color, threshold: boolean): FormCall {
  const [dr, dg, db] = colorRawRgb(dark);
  const [lr, lg, lb] = colorRawRgb(light);
  const delta = (from: number, to: number): Dimension => makeDimension(subExact(to, from));
  return [
    threshold ? forms.contrastBelow : forms.contrastBetween,
    color,
    makeDimension(t),
    makeDimension(linear(dr)), delta(linear(dr), linear(lr)),
    makeDimension(linear(dg)), delta(linear(dg), linear(lg)),
    makeDimension(linear(db)), delta(linear(db), linear(lb)),
    makeDimension(dark.alpha), delta(dark.alpha, light.alpha)
  ];
}

/** The luminance where the contrast ratios with `dark` and `light` are equal: a colour at or below it picks `light` (WCAG 2.1, Q13). */
const switchPoint = (lumaDark: number, lumaLight: number): number => Math.sqrt((lumaDark + 0.05) * (lumaLight + 0.05)) - 0.05;

const PARAMS = [COLOR_ARG, /* @__PURE__ */ optional({ type: 'Color', check: checkColor }), /* @__PURE__ */ optional({ type: 'Color', check: checkColor }), /* @__PURE__ */ optional({ type: 'Dimension', check: checkDimension })] as const;

function picked(color: ValueGroup, givenDark?: Color, givenLight?: Color, threshold?: Dimension): FormCall | Color {
  const first = givenDark ?? BLACK;
  const second = givenLight ?? WHITE;
  const lumaFirst = givenDark === undefined ? 0 : getLuma(first);
  const lumaSecond = givenLight === undefined ? 1 : getLuma(second);
  const swapped = lumaFirst > lumaSecond;
  const dark = swapped ? second : first;
  const light = swapped ? first : second;
  const lumaDark = swapped ? lumaSecond : lumaFirst;
  const lumaLight = swapped ? lumaFirst : lumaSecond;
  const below = threshold === undefined ? undefined : threshold.unit === '%' ? threshold.number / 100 : threshold.number;
  if (isValueGroupArray(color) || color.type !== 'Color') {
    if (below !== undefined) {
      return between(color, below, dark, light, true);
    }
    if (lumaDark === lumaLight) {
      return light;
    }
    const t = switchPoint(lumaDark, lumaLight);
    return givenDark === undefined && givenLight === undefined ? [forms.contrast, color, makeDimension(t)] : between(color, t, dark, light, false);
  }
  const luma = getLuma(color);
  const picksLight = below === undefined ? contrastRatio(luma, lumaLight) >= contrastRatio(luma, lumaDark) : luma < below;
  return reformatColor(picksLight ? light : dark, color.format);
}

/**
 * `contrast(color, dark = black, light = white, threshold?)`: a known `color`
 * picks `dark` or `light` by the larger WCAG 2.1 contrast ratio, or with a
 * `threshold` by whether its luma is below it (a `%` threshold is a fraction of
 * 1). Unknown, it is one relative colour that makes the same choice in the
 * browser (V40, owner 2026-11-16: *"Exact form (Recommended)"*), a threshold
 * included; an unknown `dark` or `light` has none, a relative colour reading one
 * origin. A pair of equal luma ties for every colour, so it is `light`. The two are swapped if `dark` is the lighter, and a known result takes
 * `color`'s format.
 */
export const contrast: Fn = /* @__PURE__ */ defineForm('contrast', { params: PARAMS, form: picked, filter: true });
