import type { Fn } from '@jesscss/core';
import { colorHslClamped, defineFunction, makeDimension } from '@jesscss/core';
import { noExcess, requireColor } from './kernels.js';

/**
 * `color.saturation(color)` — the hsl saturation as a percentage.
 *
 * dart-sass: `color.saturation(hsl(120,50%,50%))` → `50%`;
 * `color.saturation(#f00)` → `100%`; `color.saturation(#808080)` → `0%`.
 */
export const saturation: Fn = defineFunction('saturation', {
  params: [{ name: 'color', type: 'Color' }, { name: 'excess', type: 'any', optional: true }],
  body: (c, excess) => {
    noExcess(excess, 1);
    return makeDimension(colorHslClamped(requireColor(c))[1] * 100, '%');
  }
});

export default saturation;
