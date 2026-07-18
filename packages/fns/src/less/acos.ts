import { defineUnaryMathFunction } from './math-factory.js';

/**
 * Less `acos()` — arc cosine, returned in radians.
 * @param value unitless number or `Dimension`
 * @returns the angle as a `rad` `Dimension`
 */
export default defineUnaryMathFunction('acos', 'acos', 'rad');
