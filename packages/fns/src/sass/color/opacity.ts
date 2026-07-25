import type { Fn } from '@jesscss/core/value';
import { defineFunction, makeDimension } from '@jesscss/core/value';
import { clamp01, noExcess, requireColor } from './kernels.js';

/**
 * `color.opacity(color)` — the alpha channel as a unitless number.
 *
 * dart-sass: `color.opacity(rgba(0,0,0,0.4))` → `0.4`; `color.opacity(#f00)` → `1`.
 *
 * The CSS-filter overload is NOT a colour operation: `opacity(0.5)` and
 * `opacity(50%)` emit VERBATIM in dart-sass. A non-`Color` argument fails the
 * kind check, which under `functionMode: preserve` re-emits the call as authored
 * — the same observable result, with no hand-rolled passthrough branch.
 */
export const opacity: Fn = defineFunction('opacity', {
  params: [{ name: 'color', kinds: ['Color'] }, { name: 'excess', kinds: 'any', optional: true }],
  body: (c, excess) => {
    noExcess(excess, 1);
    return makeDimension(clamp01(requireColor(c).alpha));
  }
});

export default opacity;
