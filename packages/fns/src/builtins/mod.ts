import type { Dimension, Fn } from '@jesscss/core/value';
import { makeDimension, defineFunction } from '@jesscss/core/value';

/** `mod(a, b)` — `a % b`, keeping `a`'s unit. */
export const mod: Fn = defineFunction('mod', {
  params: [{ kinds: ['Dimension'] }, { kinds: ['Dimension'] }],
  body: (a, b) => makeDimension((a as Dimension).number % (b as Dimension).number, (a as Dimension).unit)
});
