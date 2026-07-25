import type { Fn } from '@jesscss/core/value';
import { defineFunction } from '@jesscss/core/value';
import { fractionAmount, noExcess, requireColor, withAlpha } from './kernels.js';

/**
 * `color.opacify(color, amount)` — raise alpha by an absolute 0-1 amount.
 *
 * This is the PROVEN non-alias: Less's `fadein` takes a percentage (`10%` means
 * +0.1), Sass takes a 0-1 fraction and REJECTS a percentage —
 * `opacify(rgba(255,0,0,.5), 10%)` → `$amount: Expected 10% to be within 0 and 1`
 * — so re-exporting the Less body here would error on every correct call site.
 *
 * dart-sass: `opacify(rgba(255,0,0,0.5), 0.1)` → `rgba(255, 0, 0, 0.6)`;
 * `opacify(rgba(255,0,0,0.5), 0.9)` → `red` (clamped to 1).
 */
export const opacify: Fn = defineFunction('opacify', {
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

export default opacify;
