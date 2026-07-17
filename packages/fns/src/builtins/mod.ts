import type { Dimension } from '@jesscss/core/value';
import { makeDimension } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `mod(a, b)` — `a % b`, keeping `a`'s unit. */
export const mod: Fn = {
  name: 'mod',
  params: [{ kinds: ['Dimension'] }, { kinds: ['Dimension'] }],
  body: (a, b) => makeDimension((a as Dimension).number % (b as Dimension).number, (a as Dimension).unit),
};
