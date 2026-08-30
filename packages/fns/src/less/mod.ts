import type { Fn } from '@jesscss/core';
import { makeDimension, defineFunction } from '@jesscss/core';
import { requireDimension } from './math-helper.js';

/** `mod(a, b)` — `a % b`, keeping `a`'s unit. */
export const mod: Fn = defineFunction('mod', {
  params: [{ type: 'Dimension' }, { type: 'Dimension' }],
  body: (a, b) => {
    const first = requireDimension(a);
    return makeDimension(first.number % requireDimension(b).number, first.unit);
  }
});
