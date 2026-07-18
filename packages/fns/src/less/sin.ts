import { defineUnaryMathFunction } from './math-factory.js';

/**
 * Less `sin()` — sine of an angle. Angle units (`deg`/`grad`/`turn`) are
 * normalized to radians first; a unitless input is treated as radians.
 * @param value angle as a `Dimension` (or unitless number, in radians)
 * @returns the unitless sine
 */
export default defineUnaryMathFunction('sin', 'sin', '');
