import type { Fn } from '@jesscss/core';
import { defineFunction } from '@jesscss/core';
import { hslAdjust } from './kernels.js';

/**
 * `color.desaturate(color, amount)` — lower the hsl saturation, clamped to 0%.
 *
 * dart-sass: `desaturate(#888, 10%)` → `#888888`;
 * `desaturate(hsl(120,50%,50%), 20%)` → `hsl(120, 30%, 50%)`;
 * `desaturate(#f00, 200%)` → `$amount: Expected 200% to be within 0% and 100%`.
 */
export const desaturate: Fn = defineFunction('desaturate', {
  params: [
    { name: 'color', type: 'Color' },
    { name: 'amount', type: 'Dimension' },
    { name: 'excess', type: 'any', optional: true }
  ],
  body: hslAdjust(1, -1)
});

export default desaturate;
