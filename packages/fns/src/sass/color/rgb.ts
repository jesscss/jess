import type { Fn, ValueGroup } from '@jesscss/core';
import { defineFunction, groupItems } from '@jesscss/core';
import { isModern, makeRgb } from './kernels.js';

/**
 * Sass `rgb()` — construct an rgb colour, or re-alpha an existing one.
 *
 * A separate body from Less's, not a re-export: Less preserves the AUTHORED
 * percent spelling of a channel (`rgb(50%, 0, 0)` emits `50%`) while Sass scales
 * it (`rgb(50%,0%,0%)` → `rgb(127.5, 0, 0)`), and Sass clamps channels into
 * 0-255 (`rgb(300,0,0)` → `rgb(255, 0, 0)`, `rgb(-10,0,0)` → `rgb(0, 0, 0)`)
 * where Less does not. Fractions survive the clamp (`rgb(1.5,2.5,3.5)` →
 * `rgb(1.5, 2.5, 3.5)`) — quantization belongs to the output boundary.
 *
 * Overloads covered: three/four positional channels, the space/slash modern form
 * (`rgb(1 2 3 / 0.5)`), and the colour + alpha form (`rgb(#f00, 0.5)`).
 */
export const rgb: Fn = defineFunction('rgb', {
  params: [
    { name: 'red', type: 'any' },
    { name: 'green', type: 'any', optional: true },
    { name: 'blue', type: 'any', optional: true },
    { name: 'alpha', type: 'any', optional: true }
  ],
  variadic: true,
  body: (list: ValueGroup) => makeRgb(groupItems(list), isModern(list))
});

export default rgb;
