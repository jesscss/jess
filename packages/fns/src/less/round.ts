import legacyRound from '../shared/math/round.js';
import type { Dimension, Fn, ValueObj } from '@jesscss/core/value';
import { makeDimension, round as roundNumber } from '@jesscss/core/value';

/**
 * Retained JavaScript-callable Less surface. The AST registry below does not
 * dispatch through this legacy callable.
 */
export default legacyRound;

const ZERO = makeDimension(0);

function dimensionOf(value: ValueObj): Dimension {
  if (value.type !== 'Dimension') {
    throw new TypeError('round() requires a dimension');
  }
  return value;
}

/** Canonical AST-v2 Less `round(value, precision = 0)` implementation. */
export const round: Fn = {
  name: 'round',
  params: [{ kinds: ['Dimension'] }, { kinds: ['Dimension'], optional: true }],
  body: (value, precision) => {
    const input = dimensionOf(value);
    const digits = dimensionOf(precision ?? ZERO);
    return makeDimension(roundNumber(input.number, digits.number), input.unit);
  }
};
