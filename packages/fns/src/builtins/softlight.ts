import { defineFunction } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';
import { colorBlend, requireColor } from './color-helper.js';

/** per-channel `soft-light` blend (W3C compositing-1). */
export const softlightBase = (cb: number, cs: number): number => {
  let d = 1;
  let e = cb;
  if (cs > 0.5) {
    e = 1;
    d = cb > 0.25 ? Math.sqrt(cb) : ((16 * cb - 12) * cb + 4) * cb;
  }
  return cb - (1 - 2 * cs) * e * (d - cb);
};

/** `softlight(color1, color2)` — Photoshop soft-light blend. Byte-faithful to `less/softlight`. */
export const softlight: Fn = defineFunction('softlight', {
  params: [{ kinds: ['Color'] }, { kinds: ['Color'] }],
  body: (c1, c2) => colorBlend(softlightBase, requireColor(c1), requireColor(c2))
});
