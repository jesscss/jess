import type { Fn } from '@jesscss/core/value';
import { colorLightness, makeDimension, define, checkColor, checkAny, optional } from '@jesscss/core/value';
import { noExcess, requireColor } from './kernels.js';

/**
 * `color.lightness(color)` — the hsl lightness as a percentage.
 *
 * dart-sass: `color.lightness(hsl(120,50%,50%))` → `50%`;
 * `color.lightness(#f00)` → `50%`.
 */
export const lightness: Fn = define('lightness', {
  params: [{ name: 'color', type: 'Color', check: checkColor }, /* @__PURE__ */ optional({ name: 'excess', type: 'any', check: checkAny })],
  body: (c, excess) => {
    noExcess(excess, 1);
    return makeDimension(colorLightness(requireColor(c)) * 100, '%');
  }
});

export default lightness;
