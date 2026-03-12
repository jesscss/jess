/**
 * Sass unitless() function (global) / math.is-unitless() (module)
 *
 * Checks if a number has no units.
 *
 * @example
 * unitless(10) // true
 * unitless(10px) // false
 */
import { defineFunction, Dimension, Bool } from '@jesscss/core';

const unitless = defineFunction(
  'unitless',
  function(number: Dimension): Bool {
    const hasUnit = number.data.unit !== undefined && number.data.unit !== '';
    return new Bool(!hasUnit);
  },
  {
    params: [
      {
        name: 'number',
        type: Dimension
      }
    ]
  }
);

export default unitless;
