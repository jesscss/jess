import type { Fn } from '@jesscss/core/value';
import { colorRawRgb, defineFunction, makeColorRgb } from '@jesscss/core/value';
import { noExcess, percentAmount, requireColor } from './kernels.js';

/**
 * `color.invert(color, $weight: 100%)` — mix the channel-wise inverse into the
 * original by `weight`, preserving alpha and format.
 *
 * dart-sass: `invert(#123456)` → `#edcba9`; `invert(rgba(255,0,0,0.5))` →
 * `rgba(0, 255, 255, 0.5)`; `color.invert(hsl(120,50%,50%))` →
 * `hsl(300, 50%, 50%)`; `color.invert(#f00, 50%)` → `rgb(127.5, 127.5, 127.5)`;
 * `color.invert(#123456, 20%)` → `rgb(61.8, 82.2, 102.6)`; and — pinning the
 * weight SCALE — `invert(#f00, 0.5)` → `rgb(253.725, 1.275, 1.275)`, i.e. a bare
 * `0.5` means half a percent, not half.
 *
 * `invert(50%)` (the CSS filter) is not a colour call: it fails the kind check
 * and re-emits verbatim, matching dart-sass.
 */
export const invert: Fn = defineFunction('invert', {
  params: [
    { name: 'color', kinds: ['Color'] },
    { name: 'weight', kinds: ['Dimension'], optional: true },
    { name: 'excess', kinds: 'any', optional: true }
  ],
  body: (c, weight, excess) => {
    noExcess(excess, 2);
    const color = requireColor(c);
    const w = weight === undefined ? 1 : percentAmount(weight);
    const rgb = colorRawRgb(color);
    const blend = (v: number): number => (255 - v) * w + v * (1 - w);
    return makeColorRgb([blend(rgb[0]), blend(rgb[1]), blend(rgb[2])], color.alpha, color.format);
  }
});

export default invert;
