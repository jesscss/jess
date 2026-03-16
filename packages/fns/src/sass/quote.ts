/**
 * Sass quote() function
 *
 * Adds quotes to a string.
 *
 * @example
 * quote(hello) // "hello" (quoted)
 */
import { defineFunction, Quoted } from '@jesscss/core';

const quote = defineFunction(
  'quote',
  function(string: Quoted): Quoted {
    // If already quoted, return as-is
    if (string.quote) {
      return string;
    }
    // Create new Quoted with quote option (quoted)
    const value = typeof string.data === 'string' ? string.data : string.valueOf();
    return new Quoted(value, { quote: '"' });
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

export default quote;
