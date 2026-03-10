/**
 * Sass map module (sass:map)
 *
 * Re-exports all map functions that are available in the sass:map module.
 * These are the modern, non-deprecated functions.
 *
 * Usage:
 * ```typescript
 * import { get, set, merge } from '@jesscss/fns/sass/map';
 * get($map, 'key');
 * ```
 */

export { default as get } from './get.js';
export { default as set } from './set.js';
export { default as merge } from './merge.js';
export { default as remove } from './remove.js';
export { default as keys } from './keys.js';
export { default as values } from './values.js';
export { default as hasKey } from './has-key.js';
// TODO: Implement remaining map module functions
// - map.deep-merge()
// - map.deep-remove()
