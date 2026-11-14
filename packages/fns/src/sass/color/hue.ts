import type { Fn } from '@jesscss/core/value';
import { colorHslClamped, makeDimension, define, checkColor, checkAny } from '@jesscss/core/value';
import { noExcess, requireColor } from './kernels.js';

/**
 * `color.hue(color)` — the hue in DEGREES. The unit is the divergence from Less,
 * which returns the same number unitless.
 *
 * dart-sass: `color.hue(#f00)` → `0deg`; `color.hue(hsl(120,50%,50%))` → `120deg`.
 */
export const hue: Fn = define('hue', {
  params: [{ name: 'color', type: 'Color', check: checkColor }, { name: 'excess', type: 'any', check: checkAny, optional: true }],
  body: (c, excess) => {
    noExcess(excess, 1);
    return makeDimension(colorHslClamped(requireColor(c))[0], 'deg');
  }
});

export default hue;
