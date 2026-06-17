/**
 * Sass unquote() function
 *
 * Removes quotes from a string.
 *
 * @example
 * unquote("hello") // hello (unquoted)
 */
import { defineFunction, Quoted } from '@jesscss/core';

const unquote = defineFunction(
  'unquote',
  function(string: Quoted): Quoted {
    // If already unquoted (no quote option), return as-is
    if (!string.quote) {
      return string;
    }
    const value = String(typeof string.value === 'string' ? string.value : string.valueOf());
    return new Quoted(value);
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

export default unquote;
