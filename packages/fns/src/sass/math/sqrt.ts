import { defineFunction } from '@jesscss/core';
import { applyMath } from '../../shared/math/math-helper.js';
import { assertNoUnits } from './units.js';

/**
 * Sass `math.sqrt($number)`.
 *
 * The same computation as Less's `sqrt` (`applyMath(Math.sqrt, …)`); Less keeps
 * the unit (`sqrt(4px)` → `2px`), Dart Sass requires a unitless number:
 *   math.sqrt(2)    → 1.4142135624
 *   math.sqrt(1px)  → Error: $number: Expected 1px to have no units.
 * (sass-spec `core_functions/math/sqrt.hrx`.)
 */
const sqrt = defineFunction('sqrt', {
  params: [{ name: 'number', type: 'Dimension' }] as const,
  body: number => applyMath(Math.sqrt, null, [assertNoUnits(number, 'number')])
});

export { sqrt };
export default sqrt;
