import type { Dimension } from '../value-eval.js';
import { makeDimension } from '../value-factory.js';
import type { Fn } from './types.js';

/** `mod(a, b)` — `a % b`, keeping `a`'s unit. */
export const mod: Fn = {
  name: 'mod',
  params: [{ kinds: ['dimension'] }, { kinds: ['dimension'] }],
  body: (a, b) => makeDimension((a as Dimension).number % (b as Dimension).number, (a as Dimension).unit),
};
