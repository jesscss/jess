import { defineFunction, makeDimension } from '@jesscss/core/value';
import { isUnitlessDimension } from './units.js';

/**
 * Sass `math.percentage($number)` / the global `percentage()`.
 *
 * NOT Less's `percentage()`, which happily multiplies a UNIT'D number by 100
 * (`percentage(50px)` → `5000%`). Sass REQUIRES a unitless number.
 *
 * Verified against dart-sass 1.101.0:
 *   percentage(0.5)   → 50%
 *   percentage(2)     → 200%
 *   percentage(-0.5)  → -50%
 *   percentage(50px)  → Error: $number: Expected 50px to have no units.
 *   percentage(50%)   → Error: $number: Expected 50% to have no units.
 */
const percentage = defineFunction('percentage', {
  params: [{ name: 'number', kinds: ['Dimension'] }] as const,
  body: (number) => {
    if (!isUnitlessDimension(number)) {
      throw new TypeError(`$number: Expected ${number.bytes} to have no units.`);
    }
    return makeDimension(number.number * 100, '%');
  }
});

export { percentage };
export default percentage;
