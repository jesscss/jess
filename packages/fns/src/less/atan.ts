import { defineUnaryMathFunction } from './math-factory.js';

/**
 * Less `atan()` — arc tangent, returned in radians.
 * @param value unitless number or `Dimension`
 * @returns the angle as a `rad` `Dimension`
 */
export default defineUnaryMathFunction('atan', 'atan', 'rad');
