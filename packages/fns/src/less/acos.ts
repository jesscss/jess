import { defineUnaryMathFunction } from './math-factory.js';
import type { Fn } from '@jesscss/core/value';
import { makeDimension } from '@jesscss/core/value';

/**
 * Less `acos()` — arc cosine, returned in radians.
 * @param value unitless number or `Dimension`
 * @returns the angle as a `rad` `Dimension`
 */
export default defineUnaryMathFunction('acos', 'acos', 'rad');

/** Canonical AST-v2 Less `acos(value)` implementation. */
export const acos: Fn = {
  name: 'acos',
  params: [{ kinds: ['Dimension'] }],
  body: (value) => {
    if (value.type !== 'Dimension') {
      throw new TypeError('acos expects a Dimension');
    }
    return makeDimension(Math.acos(value.number), 'rad');
  }
};
