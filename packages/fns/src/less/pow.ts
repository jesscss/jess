import type { Fn } from '@jesscss/core/value';
import { defineFunction } from '@jesscss/core/value';
import { applyMath, requireDimension } from '../shared/math/math-helper.js';
import { fitsNumber } from './css-math-args.js';

/** `pow(x, y)` — `x^y`, keeping `x`'s unit. No angle normalization (legacy parity). */
export const pow: Fn = defineFunction('pow', {
  cssFunction: true,
  params: [{ type: 'Dimension', fits: fitsNumber }, { type: 'Dimension', fits: fitsNumber }],
  body: (x, y) => applyMath(Math.pow, null, [requireDimension(x), requireDimension(y)])
});
