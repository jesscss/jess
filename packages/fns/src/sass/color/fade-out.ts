import type { Fn } from '@jesscss/core';
import { defineFunction } from '@jesscss/core';
import { fractionAmount, noExcess, requireColor, withAlpha } from './kernels.js';

/**
 * `color.fade-out(color, amount)` — the `transparentize` computation under Sass's
 * other name for it. NOT Less's `fadeout` (0-1 fraction, percentage rejected).
 *
 * dart-sass: `fade-out(rgba(255,0,0,0.5), 0.1)` → `rgba(255, 0, 0, 0.4)`;
 * `fade-out(rgba(255,0,0,0.5), 10%)` → `$amount: Expected 10% to be within 0 and 1`.
 */
export const fadeOut: Fn = defineFunction('fade-out', {
  params: [
    { name: 'color', type: 'Color' },
    { name: 'amount', type: 'Dimension' },
    { name: 'excess', type: 'any', optional: true }
  ],
  body: (c, amt, excess) => {
    noExcess(excess, 2);
    const color = requireColor(c);
    return withAlpha(color, color.alpha - fractionAmount(amt));
  }
});

export default fadeOut;
