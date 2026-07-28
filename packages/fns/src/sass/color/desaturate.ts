import type { Fn } from '@jesscss/core/value';
import { defineFunction } from '@jesscss/core/value';
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
    { name: 'color', kinds: ['Color'] },
    { name: 'amount', kinds: ['Dimension'] },
    { name: 'excess', kinds: 'any', optional: true }
  ],
  body: hslAdjust(1, -1)
});

export default desaturate;
