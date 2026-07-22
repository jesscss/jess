import type { Dimension, Fn } from '@jesscss/core/value';
import { makeDimension, defineFunction } from '@jesscss/core/value';

/** `pow(x, y)` — `x^y`, keeping `x`'s unit. No angle normalization (legacy parity). */
export const pow: Fn = defineFunction('pow', {
  params: [{ kinds: ['Dimension'] }, { kinds: ['Dimension'] }],
  body: (x, y) => makeDimension(Math.pow((x as Dimension).number, (y as Dimension).number), (x as Dimension).unit)
});
