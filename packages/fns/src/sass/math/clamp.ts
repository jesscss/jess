import { compareOrder, defineFunction } from '@jesscss/core/value';
import { convertToMatch } from './units.js';

/**
 * Sass `math.clamp($min, $number, $max)`. Less has no `clamp` function (CSS
 * `clamp()` is written out as CSS).
 *
 * `$number` and `$max` must match `$min`'s units (a unitless number does not mix
 * with a unit'd one); the result is whichever argument wins, as written:
 *   math.clamp(0, 1, 2)                       → 1
 *   math.clamp(0, 2, 1)                       → 1
 *   math.clamp(180deg, 0.75turn, 360deg)      → 0.75turn
 *   math.clamp(1deg, 1px, 1turn)              → Error: $number: 1px and $min: 1deg have incompatible units.
 * When `$min` is not below `$max`, `$min` wins. (sass-spec `core_functions/math/clamp.hrx`.)
 */
const clamp = defineFunction('clamp', {
  params: [
    { name: 'min', type: 'Dimension' },
    { name: 'number', type: 'Dimension' },
    { name: 'max', type: 'Dimension' }
  ] as const,
  body: (min, number, max) => {
    convertToMatch(number, min, '$number', '$min');
    convertToMatch(max, min, '$max', '$min');
    if (compareOrder(min, max) >= 0 || compareOrder(min, number) >= 0) {
      return min;
    }
    return compareOrder(number, max) >= 0 ? max : number;
  }
});

export { clamp };
export default clamp;
