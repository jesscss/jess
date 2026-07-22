import type { Color, Fn } from '@jesscss/core/value';
import { makeDimension, defineFunction } from '@jesscss/core/value';

/** `alpha(color)` — the clamped alpha channel (0-1). Byte-faithful to `less/alpha`. */
export const alpha: Fn = defineFunction('alpha', {
  params: [{ kinds: ['Color'] }],
  body: c => makeDimension(Math.min(Math.max((c as Color).alpha, 0), 1), '')
});
