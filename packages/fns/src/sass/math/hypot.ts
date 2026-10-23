import { defineFunction, makeDimension, type Dimension } from '@jesscss/core';
import { convertToMatch } from './units.js';

/**
 * Sass `math.hypot($numbers...)`. Less has no counterpart.
 *
 * Every argument is converted to the first one's units (a unitless number does
 * not mix with a unit'd one) and the result carries the first one's units.
 *   math.hypot(3, 4, 5, 6, 7)       → 11.6189500386
 *   math.hypot(1deg, 1px, 1turn)    → Error: $numbers[2]: 1px and $numbers[1]: 1deg have incompatible units.
 *   math.hypot(0, 1px, 2px)         → Error: $numbers[2]: 1px and $numbers[1]: 0 have incompatible units (one has units and the other doesn't).
 *   math.hypot()                    → Error: At least one argument must be passed.
 * (sass-spec `core_functions/math/hypot.hrx`.)
 */
const hypot = defineFunction('hypot', {
  params: [{ name: 'numbers', type: 'Dimension', rest: true }] as const,
  body: (numbers: readonly Dimension[]) => {
    const first = numbers[0];
    if (first === undefined) {
      throw new TypeError('At least one argument must be passed.');
    }
    let sum = 0;
    for (let index = 0; index < numbers.length; index++) {
      sum += convertToMatch(numbers[index]!, first, `$numbers[${index + 1}]`, '$numbers[1]') ** 2;
    }

    // ponytail: a compound first unit keeps only its display spelling, not its multiset.
    return makeDimension(Math.sqrt(sum), first.unit);
  }
});

export { hypot };
export default hypot;
