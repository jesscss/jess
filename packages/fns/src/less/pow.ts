import { defineFunction, makeDimension } from '@jesscss/core/value';

/**
 * Less `pow()` — raise `x` to the power of `y`. The result keeps `x`'s unit; `y`
 * contributes only its numeric value.
 * @param x base `Dimension`
 * @param y exponent `Dimension`
 * @returns `x ^ y` as a `Dimension` with `x`'s unit
 */
const pow = defineFunction('pow', {
  params: [{ name: 'x', kinds: ['Dimension'] }, { name: 'y', kinds: ['Dimension'] }] as const,
  body: (x, y) => makeDimension(Math.pow(x.number, y.number), x.unit)
});

export { pow };
export default pow;
