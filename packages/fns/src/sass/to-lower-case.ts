/**
 * Sass to-lower-case() function
 *
 * Converts a string to lowercase.
 *
 * @example
 * to-lower-case("HELLO") // "hello"
 */
import { defineFunction, Quoted } from '@jesscss/core';

const toLowerCase = defineFunction(
  'to-lower-case',
  function(string: Quoted): Quoted {
    const value = String(typeof string.get('value') === 'string' ? string.get('value') : string.valueOf());
    const lowerValue = value.toLowerCase();
    return new Quoted(lowerValue, string.options);
  },
  {
    params: [
      {
        name: 'string',
        type: Quoted
      }
    ]
  }
);

export default toLowerCase;
