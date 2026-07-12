/**
 * Sass string module (sass:string)
 *
 * Re-exports all string functions that are available in the sass:string module.
 * These are the modern, non-deprecated functions.
 *
 * Usage:
 * ```typescript
 * import { length, unquote, quote } from '@jesscss/fns/sass/string';
 * length("hello"); // 5
 * ```
 */

// String functions (available in string module)
export { default as length } from './length.js';
export { default as unquote } from '../unquote.js';
export { default as quote } from '../quote.js';
export { default as toUpperCase } from '../to-upper-case.js';
export { default as toLowerCase } from '../to-lower-case.js';
export { default as uniqueId } from '../unique-id.js';
// TODO: Implement remaining string module functions
// - string.index() (use str-index for now)
// - string.insert() (use str-insert for now)
// - string.slice() (use str-slice for now)
// - string.split()
