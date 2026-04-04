/**
 * Sass random() function
 *
 * Returns a random number between 0 and 1, or between 1 and limit (inclusive).
 *
 * @example
 * random() // 0.123456...
 * random(10) // 5 (random integer between 1 and 10)
 */
import { defineFunction, Dimension } from '@jesscss/core';
import { toNumber } from '@jesscss/core';

const random = defineFunction(
  'random',
  function(limit?: Dimension): Dimension {
    if (limit === undefined) {
      // Return random number between 0 and 1
      return new Dimension({ number: Math.random(), unit: undefined });
    }

    // Limit must be a positive integer
    const limitValue = toNumber()(limit) as number;
    const limitInt = Math.floor(limitValue);

    if (limitInt < 1) {
      throw new Error('$limit: Must be greater than 0');
    }

    // Return random integer between 1 and limit (inclusive)
    const randomInt = Math.floor(Math.random() * limitInt) + 1;
    return new Dimension({ number: randomInt, unit: undefined });
  },
  {
    params: [
      {
        name: 'limit',
        type: Dimension,
        optional: true,
        convert: [toNumber()]
      }
    ]
  }
);

export default random;
