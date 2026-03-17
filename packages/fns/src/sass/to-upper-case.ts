/**
 * Sass to-upper-case() function
 *
 * Converts a string to uppercase.
 *
 * @example
 * to-upper-case("hello") // "HELLO"
 */
import { defineFunction, Quoted } from '@jesscss/core';

const toUpperCase = defineFunction(
  'to-upper-case',
  function(string: Quoted): Quoted {
    const value = typeof string.value === 'string' ? string.value : string.valueOf();
    const upperValue = value.toUpperCase();
    return new Quoted(upperValue, string.options);
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

export default toUpperCase;
