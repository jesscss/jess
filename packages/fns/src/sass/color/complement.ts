import type { Fn } from '@jesscss/core/value';
import { defineFunction } from '@jesscss/core/value';
import { noExcess, requireColor, rotateHue } from './kernels.js';

/**
 * `color.complement(color)` — the hue rotated by 180 degrees.
 *
 * dart-sass: `complement(#f00)` → `aqua`; `complement(hsl(10,90%,50%))` →
 * `hsl(190, 90%, 50%)`; `complement(#808080)` → `gray` (an unsaturated colour is
 * its own complement); `complement(rgba(255,0,0,0.5))` → `rgba(0, 255, 255, 0.5)`;
 * `complement(rgb(1.6,2,3))` → `rgb(3, 2.6, 1.6)` (fractional channels survive
 * the hsl round-trip un-rounded).
 *
 * The `$space` argument (`complement(#f00, oklch)`) needs a colour-space model
 * jess does not have yet; an extra argument therefore fails and the call is left
 * verbatim rather than silently answering the legacy-space result.
 */
export const complement: Fn = defineFunction('complement', {
  params: [{ name: 'color', kinds: ['Color'] }, { name: 'excess', kinds: 'any', optional: true }],
  body: (c, excess) => {
    noExcess(excess, 1);
    return rotateHue(requireColor(c), 180);
  }
});

export default complement;
