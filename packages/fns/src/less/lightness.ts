import type { Color, Dimension, Fn } from '@jesscss/core/value';
import { colorLightness, define, makeDimension, checkColor } from '@jesscss/core/value';

/**
 * `lightness(color)`'s body: the hsl lightness of a colour as a percentage.
 * {@link lightness} is `define` over it, which checks the argument first; a
 * generated runtime module calls it directly where it proves the argument a
 * colour (`@jesscss/fns/less/bodies`).
 */
export const lightnessOf = (c: Color): Dimension => makeDimension(colorLightness(c) * 100, '%');

/** `lightness(color)` — the hsl lightness as a percentage. */
export const lightness: Fn = /* @__PURE__ */ define('lightness', {
  params: [{ type: 'Color', check: checkColor }],
  body: lightnessOf,
  bodyExport: { module: '@jesscss/fns/less/bodies', name: 'lightnessOf', bytes: true }
});
