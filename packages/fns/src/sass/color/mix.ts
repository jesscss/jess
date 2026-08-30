import type { Fn } from '@jesscss/core';
import { defineFunction } from '@jesscss/core';
import { mixColors, noExcess, requireColor, weightAmount } from './kernels.js';

/**
 * `color.mix(color1, color2, $weight: 50%)` — weighted blend.
 *
 * The alpha-aware weighting matches Less's, but two things differ and both are
 * pinned by `sass-spec/core_functions/color/mix/**`: the blend runs over the RAW
 * (unrounded) channels — `color.mix(#ff00ff, #00ff00)` → `rgb(127.5, 127.5,
 * 127.5)`, `color.mix(#91e16f, #0144bf)` → `rgb(73, 146.5, 151)` — where Less
 * rounds its operands and quantizes the result back into hex (`#800080`).
 *
 * `$weight` is a percentage: `mix/units.hrx` accepts a unitless `50` (and even
 * `50px`) as 50%, with a deprecation warning rather than an error.
 *
 * The `$method` colour-space argument (`mix(#f00, #00f, 50%, oklch)`) needs a
 * colour-space model jess does not have; a fourth argument fails so the call is
 * left verbatim instead of silently answering the legacy-space result.
 */
export const mix: Fn = defineFunction('mix', {
  params: [
    { name: 'color1', type: 'Color' },
    { name: 'color2', type: 'Color' },
    { name: 'weight', type: 'Dimension', optional: true },
    { name: 'excess', type: 'any', optional: true }
  ],
  body: (c1, c2, weight, excess) => {
    noExcess(excess, 3);
    return mixColors(requireColor(c1), requireColor(c2), weight === undefined ? 0.5 : weightAmount(weight));
  }
});

export default mix;
