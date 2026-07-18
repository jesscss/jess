import { defineUnaryMathFunction } from './math-factory.js';

/**
 * Less `sqrt()` — square root, preserving the input unit.
 * @param value number or `Dimension`
 * @returns the square root as a `Dimension` carrying the input's unit
 */
export default defineUnaryMathFunction('sqrt', 'sqrt', null);
