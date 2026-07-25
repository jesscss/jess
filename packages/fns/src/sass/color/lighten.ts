import type { Fn } from '@jesscss/core/value';
import { defineFunction } from '@jesscss/core/value';
import { hslAdjust } from './kernels.js';

/**
 * `color.lighten(color, amount)` — raise the hsl lightness, clamped to 100%.
 *
 * dart-sass: `lighten(#800, 10%)` → `#bb0000`; `lighten(hsl(0,0%,90%), 20%)` →
 * `hsl(0, 0%, 100%)`; `lighten(#fff, 50%)` → `white`. Two arguments only — Less's
 * third `relative` argument is `Only 2 arguments allowed, but 3 were passed`.
 */
export const lighten: Fn = defineFunction('lighten', {
  params: [
    { name: 'color', kinds: ['Color'] },
    { name: 'amount', kinds: ['Dimension'] },
    { name: 'excess', kinds: 'any', optional: true }
  ],
  body: hslAdjust(2, 1)
});

export default lighten;
