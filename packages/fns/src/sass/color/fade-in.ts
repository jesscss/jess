import type { Fn } from '@jesscss/core/value';
import { defineFunction } from '@jesscss/core/value';
import { fractionAmount, noExcess, requireColor, withAlpha } from './kernels.js';

/**
 * `color.fade-in(color, amount)` — the `opacify` computation under Sass's other
 * name for it. NOT Less's `fadein`: the amount is a 0-1 fraction, and a
 * percentage is an error (`fade-in(rgba(255,0,0,.5), 10%)` → `$amount: Expected
 * 10% to be within 0 and 1`), where Less's `fadein(…, 10%)` means +0.1 alpha.
 *
 * dart-sass: `fade-in(rgba(255,0,0,0.5), 0.1)` → `rgba(255, 0, 0, 0.6)`;
 * `fade-in(rgba(red,0.5), 0.14)` → `rgba(255, 0, 0, 0.64)`;
 * `fade-in(rgba(red,0.5), 0)` → `rgba(255, 0, 0, 0.5)`.
 */
export const fadeIn: Fn = defineFunction('fade-in', {
  params: [
    { name: 'color', kinds: ['Color'] },
    { name: 'amount', kinds: ['Dimension'] },
    { name: 'excess', kinds: 'any', optional: true }
  ],
  body: (c, amt, excess) => {
    noExcess(excess, 2);
    const color = requireColor(c);
    return withAlpha(color, color.alpha + fractionAmount(amt));
  }
});

export default fadeIn;
