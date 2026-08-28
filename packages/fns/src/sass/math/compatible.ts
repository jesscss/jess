import { defineFunction, makeBool } from '@jesscss/core';
import { compatibleUnits } from './units.js';

const params = [
  { name: 'number1', type: 'Dimension' },
  { name: 'number2', type: 'Dimension' }
] as const;

/**
 * Sass `math.compatible($number1, $number2)`, exposed globally as `comparable()`.
 *
 * Verified against dart-sass 1.101.0:
 *   comparable(1px, 1em)  → false
 *   comparable(1px, 1cm)  → true    (same conversion group)
 *   comparable(1, 2)      → true
 *   comparable(1px, 1)    → true    (a unitless number is compatible with anything)
 *   comparable(1s, 1px)   → false
 *   comparable(1%, 1px)   → false   (`%` is in no conversion group)
 *   comparable(1%, 2%)    → true
 *   math.compatible(1px, 1px * 1px) → false
 */
const compatible = defineFunction('compatible', {
  params,
  body: (number1, number2) => makeBool(compatibleUnits(number1, number2))
});

/** The global spelling of {@link compatible}. Same body, Sass's global name. */
const comparable = defineFunction('comparable', {
  params,
  body: (number1, number2) => makeBool(compatibleUnits(number1, number2))
});

export { compatible, comparable };
export default compatible;
