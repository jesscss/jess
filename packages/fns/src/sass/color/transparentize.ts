import type { Fn } from '@jesscss/core/value';
import { defineFunction } from '@jesscss/core/value';
import { fractionAmount, noExcess, requireColor, withAlpha } from './kernels.js';

/**
 * `color.transparentize(color, amount)` — lower alpha by an absolute 0-1 amount.
 *
 * The mirror of `opacify`, and the same proven non-alias: a percentage is an
 * error here where Less's `fadeout` requires one.
 *
 * dart-sass: `transparentize(rgba(255,0,0,0.5), 0.1)` → `rgba(255, 0, 0, 0.4)`;
 * `transparentize(#f00, 0.25)` → `rgba(255, 0, 0, 0.75)`;
 * `transparentize(rgba(255,0,0,0.5), 0.9)` → `rgba(255, 0, 0, 0)`;
 * `transparentize(hsl(120,50%,50%), 0.5)` → `hsla(120, 50%, 50%, 0.5)` (hsl
 * format survives; only a hex literal turns into rgb).
 */
export const transparentize: Fn = defineFunction('transparentize', {
  params: [
    { name: 'color', kinds: ['Color'] },
    { name: 'amount', kinds: ['Dimension'] },
    { name: 'excess', kinds: 'any', optional: true }
  ],
  body: (c, amt, excess) => {
    noExcess(excess, 2);
    const color = requireColor(c);
    return withAlpha(color, color.alpha - fractionAmount(amt));
  }
});

export default transparentize;
