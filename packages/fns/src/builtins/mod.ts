import type { Fn } from '@jesscss/core/value';
import { makeDimension, defineFunction } from '@jesscss/core/value';
import { requireDimension } from './math-helper.js';

/** `mod(a, b)` — `a % b`, keeping `a`'s unit. */
export const mod: Fn = defineFunction('mod', {
  params: [{ kinds: ['Dimension'] }, { kinds: ['Dimension'] }],
  body: (a, b) => {
    const first = requireDimension(a);
    return makeDimension(first.number % requireDimension(b).number, first.unit);
  }
});
