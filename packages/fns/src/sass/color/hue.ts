import type { Fn } from '@jesscss/core/value';
import { colorHslClamped, defineFunction, makeDimension } from '@jesscss/core/value';
import { noExcess, requireColor } from './kernels.js';

/**
 * `color.hue(color)` — the hue in DEGREES. The unit is the divergence from Less,
 * which returns the same number unitless.
 *
 * dart-sass: `color.hue(#f00)` → `0deg`; `color.hue(hsl(120,50%,50%))` → `120deg`.
 */
export const hue: Fn = defineFunction('hue', {
  params: [{ name: 'color', kinds: ['Color'] }, { name: 'excess', kinds: 'any', optional: true }],
  body: (c, excess) => {
    noExcess(excess, 1);
    return makeDimension(colorHslClamped(requireColor(c))[0], 'deg');
  }
});

export default hue;
