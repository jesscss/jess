import type { Fn } from '@jesscss/core';
import { defineFunction } from '@jesscss/core';
import { degreesOf, noExcess, requireColor, requireDimension, rotateHue } from './kernels.js';

/**
 * `color.adjust-hue(color, degrees)` — rotate the hue, wrapped to 0-360.
 *
 * dart-sass: `adjust-hue(#800, 45)` → `#886600`; `adjust-hue(#800, 45deg)` →
 * `#886600`; `adjust-hue(#800, -45)` → `#880066`;
 * `adjust-hue(hsl(120,50%,50%), 45)` → `hsl(165, 50%, 50%)`.
 *
 * Same computation as Less's `spin`, different dispatch name — a Sass-owned
 * definition rather than a re-export of the Less callable.
 */
export const adjustHue: Fn = defineFunction('adjust-hue', {
  params: [
    { name: 'color', type: 'Color' },
    { name: 'degrees', type: 'Dimension' },
    { name: 'excess', type: 'any', optional: true }
  ],
  body: (c, amt, excess) => {
    noExcess(excess, 2);
    return rotateHue(requireColor(c), degreesOf(requireDimension(amt)));
  }
});

export default adjustHue;
