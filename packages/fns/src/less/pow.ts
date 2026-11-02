import type { Fn } from '@jesscss/core/value';
import { defineFunction } from '@jesscss/core/value';
import { applyMath, requireDimension } from '../shared/math/math-helper.js';

/** `pow(x, y)` — `x^y`, keeping `x`'s unit. No angle normalization (legacy parity). */
export const pow: Fn = defineFunction('pow', {
  params: [{ type: 'Dimension' }, { type: 'Dimension' }],
  body: (x, y) => applyMath(Math.pow, null, [requireDimension(x), requireDimension(y)])
});
