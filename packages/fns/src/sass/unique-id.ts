/**
 * Sass unique-id() function
 *
 * Returns a unique unquoted string identifier.
 *
 * @example
 * unique-id() // u0123456
 */
import { defineFunction, Quoted } from '@jesscss/core';

// Generate a unique ID counter
let uniqueIdCounter = 0;

const uniqueId = defineFunction(
  'unique-id',
  function(): Quoted {
    // Generate a unique ID: "u" followed by base-36 encoded counter
    // Sass uses base-36 (0-9, a-z) for 6 characters
    const id = `u${uniqueIdCounter.toString(36).padStart(6, '0')}`;
    uniqueIdCounter++;
    // Return as unquoted string
    return new Quoted(id, { quote: undefined });
  },
  {
    params: []
  }
);

export default uniqueId;
