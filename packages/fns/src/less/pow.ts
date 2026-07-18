import { Dimension, defineFunction } from '@jesscss/core';

/**
 * Less `pow()` — raise `x` to the power of `y`. The result keeps `x`'s unit; `y`
 * contributes only its numeric value.
 * @param x base `Dimension`
 * @param y exponent `Dimension`
 * @returns `x ^ y` as a `Dimension` with `x`'s unit
 */
export default defineFunction(
  'pow',
  function(x: Dimension, y: Dimension) {
    return new Dimension({
      number: Math.pow(x.number, y.number),
      unit: x.unit
    });
  },
  {
    params: [{
      name: 'x',
      type: Dimension
    }, {
      name: 'y',
      type: Dimension
    }]
  }
);
