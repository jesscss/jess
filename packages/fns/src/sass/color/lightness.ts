import type { Fn } from '@jesscss/core/value';
import { colorHslClamped, defineFunction, makeDimension } from '@jesscss/core/value';
import { noExcess, requireColor } from './kernels.js';

/**
 * `color.lightness(color)` — the hsl lightness as a percentage.
 *
 * dart-sass: `color.lightness(hsl(120,50%,50%))` → `50%`;
 * `color.lightness(#f00)` → `50%`.
 */
export const lightness: Fn = defineFunction('lightness', {
  params: [{ name: 'color', kinds: ['Color'] }, { name: 'excess', kinds: 'any', optional: true }],
  body: (c, excess) => {
    noExcess(excess, 1);
    return makeDimension(colorHslClamped(requireColor(c))[2] * 100, '%');
  }
});

export default lightness;
