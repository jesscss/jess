import type { Fn, ValueGroup } from '@jesscss/core';
import { defineFunction, groupItems } from '@jesscss/core';
import { isModern, makeHsl } from './kernels.js';

/**
 * Sass `hsl()` — construct an hsl colour, or re-alpha an existing one.
 *
 * A separate body from Less's on three counts: Sass does NOT clamp saturation or
 * lightness at the upper bound (`hsl(380deg,150%,150%)` → `hsl(20, 150%, 150%)`,
 * where Less clamps both to 100%), Sass does NOT canonicalize an achromatic
 * colour (`hsl(50, 0%, 50%)` stays `hsl(50, 0%, 50%)`; Less collapses the hue to
 * `0`), and hue accepts any angle unit wrapped to 0-360 (`hsl(-40,50%,50%)` →
 * `hsl(320, …)`, `hsl(0.5turn,…)` → `hsl(180, …)`).
 */
export const hsl: Fn = defineFunction('hsl', {
  params: [
    { name: 'hue', type: 'any' },
    { name: 'saturation', type: 'any', optional: true },
    { name: 'lightness', type: 'any', optional: true },
    { name: 'alpha', type: 'any', optional: true }
  ],
  variadic: true,
  body: (list: ValueGroup) => makeHsl(groupItems(list), isModern(list))
});

export default hsl;
