import type { Fn } from '@jesscss/core';
import { defineFunction } from '@jesscss/core';
import { hslAdjust } from './kernels.js';

/**
 * `color.darken(color, amount)` — lower the hsl lightness, clamped to 0%.
 *
 * dart-sass: `darken(#800, 10%)` → `#550000`; `darken(#800, 100%)` → `black`;
 * `darken(#000, 50%)` → `black`. Two arguments only (see `lighten`).
 */
export const darken: Fn = defineFunction('darken', {
  params: [
    { name: 'color', type: 'Color' },
    { name: 'amount', type: 'Dimension' },
    { name: 'excess', type: 'any', optional: true }
  ],
  body: hslAdjust(2, -1)
});

export default darken;
