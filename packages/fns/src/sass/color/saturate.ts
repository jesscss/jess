import type { Fn } from '@jesscss/core/value';
import { defineFunction } from '@jesscss/core/value';
import { hslAdjust } from './kernels.js';

/**
 * `color.saturate(color, amount)` — raise the hsl saturation, clamped to 100%.
 *
 * dart-sass: `saturate(#800, 10%)` → `#880000`; `saturate(#800, 10)` →
 * `#880000`; `saturate(#f00, 50%)` → `red` (already fully saturated).
 *
 * `saturate(50%)` is the CSS FILTER, not a colour call — dart-sass emits it
 * verbatim. A single `Dimension` argument fails the kind check on the colour
 * slot, which re-emits the call as authored under `functionMode: preserve`.
 */
export const saturate: Fn = defineFunction('saturate', {
  params: [
    { name: 'color', kinds: ['Color'] },
    { name: 'amount', kinds: ['Dimension'] },
    { name: 'excess', kinds: 'any', optional: true }
  ],
  body: hslAdjust(1, 1)
});

export default saturate;
