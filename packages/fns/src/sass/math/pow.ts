import { defineFunction } from '@jesscss/core';
import { applyMath } from '../../shared/math/math-helper.js';
import { assertNoUnits } from './units.js';

/**
 * Sass `math.pow($base, $exponent)`.
 *
 * The same computation as Less's `pow` (`applyMath(Math.pow, …)`); the difference
 * is the unit rule. Less keeps the base's unit (`pow(2px, 2)` → `4px`), while
 * Dart Sass requires both arguments unitless:
 *   math.pow(2, 3)     → 8
 *   math.pow(2, 0.5)   → 1.4142135624
 *   math.pow(1px, 0)   → Error: $base: Expected 1px to have no units.
 *   math.pow(0, 1px)   → Error: $exponent: Expected 1px to have no units.
 * (sass-spec `core_functions/math/pow/**`.)
 */
const pow = defineFunction('pow', {
  params: [
    { name: 'base', type: 'Dimension' },
    { name: 'exponent', type: 'Dimension' }
  ] as const,
  body: (base, exponent) => applyMath(Math.pow, null, [assertNoUnits(base, 'base'), assertNoUnits(exponent, 'exponent')])
});

export { pow };
export default pow;
