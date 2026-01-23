/**
 * Sass compatible() function (global) / math.compatible() (module)
 * 
 * Checks if two numbers have compatible units (can be compared/operated on).
 * 
 * @example
 * compatible(10px, 20px) // true
 * compatible(10px, 20rem) // false (incompatible length units)
 * compatible(10px, 20s) // false (different unit types)
 */
import { defineFunction, Dimension, Context, Bool } from '@jesscss/core';

const compatible = defineFunction(
  'compatible',
  function(number1: Dimension, number2: Dimension, context: Context): Bool {
    // Check if units are compatible by attempting a comparison
    // If they're compatible, compare() won't throw
    try {
      number1.compare(number2, context);
      return new Bool(true);
    } catch {
      return new Bool(false);
    }
  },
  {
    params: [
      {
        name: 'number1',
        type: Dimension
      },
      {
        name: 'number2',
        type: Dimension
      }
    ]
  }
);

export default compatible;
