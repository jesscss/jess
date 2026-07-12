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
    if (!string.options?.quote) {
      return string;
    }
    // Create new Quoted without quote option (unquoted)
    const value = typeof string.value === 'string' ? string.value : string.valueOf();
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
