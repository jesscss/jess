import type { Color } from '../value-eval.js';
import { makeDimension } from '../value-factory.js';
import type { NativeFn } from './types.js';

/** `alpha(color)` — the clamped alpha channel (0-1). Byte-faithful to `less/alpha`. */
export const alpha: NativeFn = {
  name: 'alpha',
  params: [{ kinds: ['color'] }],
  body: (c) => makeDimension(Math.min(Math.max((c as Color).alpha, 0), 1), ''),
};
