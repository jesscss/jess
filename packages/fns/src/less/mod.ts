import { Dimension, defineFunction } from '@jesscss/core';

/**
 * Less `mod()` — remainder of `a / b` (JavaScript `%`), keeping `a`'s unit.
 * @param a dividend `Dimension`
 * @param b divisor `Dimension`
 * @returns `a % b` as a `Dimension` with `a`'s unit
 */
export default defineFunction(
  'mod',
  function(a: Dimension, b: Dimension) {
    return new Dimension({
      number: a.number % b.number,
      unit: a.unit
    });
  },
  {
    params: [{
      name: 'a',
      type: Dimension
    }, {
      name: 'b',
      type: Dimension
    }]
  }
);
