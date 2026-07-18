import { defineUnaryMathFunction } from './math-factory.js';

/**
 * Less `asin()` — arc sine, returned in radians.
 * @param value unitless number or `Dimension`
 * @returns the angle as a `rad` `Dimension`
 */
export default defineUnaryMathFunction('asin', 'asin', 'rad');
