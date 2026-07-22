import type { Fn } from '@jesscss/core/value';
import { makeDimension, defineFunction } from '@jesscss/core/value';
import { requireDimension } from './math-helper.js';

/** `pow(x, y)` — `x^y`, keeping `x`'s unit. No angle normalization (legacy parity). */
export const pow: Fn = defineFunction('pow', {
  params: [{ kinds: ['Dimension'] }, { kinds: ['Dimension'] }],
  body: (x, y) => {
    const base = requireDimension(x);
    return makeDimension(Math.pow(base.number, requireDimension(y).number), base.unit);
  }
});
