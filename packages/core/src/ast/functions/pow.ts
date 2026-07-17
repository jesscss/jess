import type { Dimension } from '../value-eval.js';
import { makeDimension } from '../value-factory.js';
import type { Fn } from './types.js';

/** `pow(x, y)` — `x^y`, keeping `x`'s unit. No angle normalization (legacy parity). */
export const pow: Fn = {
  name: 'pow',
  params: [{ kinds: ['dimension'] }, { kinds: ['dimension'] }],
  body: (x, y) => makeDimension(Math.pow((x as Dimension).number, (y as Dimension).number), (x as Dimension).unit),
};
