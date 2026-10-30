import { defineFunction, makeDimension, type Dimension, type Null } from '@jesscss/core';
import { assertNoUnits } from './units.js';

/**
 * Sass `math.log($number, $base: null)`. Less has no logarithm.
 *
 * Both arguments unitless; without a base it is the natural logarithm.
 *   math.log(2)        → 0.6931471806
 *   math.log(2, 10)    → 0.3010299957
 *   math.log(2, null)  → 0.6931471806
 *   math.log(1px)      → Error: $number: Expected 1px to have no units.
 *   math.log(1, 1px)   → Error: $base: Expected 1px to have no units.
 * (sass-spec `core_functions/math/log.hrx`.)
 */
const log = defineFunction('log', {
  params: [
    { name: 'number', type: 'Dimension' },
    { name: 'base', type: ['Dimension', 'Null'], optional: true }
  ] as const,
  body: (number: Dimension, base: Dimension | Null | undefined) => {
    const value = Math.log(assertNoUnits(number, 'number').number);
    return makeDimension(base === undefined || base.type === 'Null' ? value : value / Math.log(assertNoUnits(base, 'base').number));
  }
});

export { log };
export default log;
