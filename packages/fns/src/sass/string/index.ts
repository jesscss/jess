/**
 * The `sass:string` module — MODULE member names.
 *
 * Every entry is a value-domain `Fn`, so this index is directly registerable
 * once the per-module registry exists. Four members are ALSO reachable under a
 * different deprecated global name (`length`→`str-length`, `index`→`str-index`,
 * `slice`→`str-slice`, `insert`→`str-insert`); those global-named callables live
 * in `./globals.js` so a flat table can never be asked to hold two different
 * functions under one key. `length` here and `sass/list`'s `length` are two
 * distinct functions with the same member name — the module table is what keeps
 * them apart.
 *
 * ```typescript
 * import * as string from '@jesscss/fns/sass/string';
 * ```
 */
export { default as length } from './length.js';
export { default as quote } from './quote.js';
export { default as unquote } from './unquote.js';
export { default as toUpperCase } from './to-upper-case.js';
export { default as toLowerCase } from './to-lower-case.js';
export { default as index } from './string-index.js';
export { default as slice } from './slice.js';
export { default as insert } from './insert.js';
export { default as uniqueId } from './unique-id.js';
// TODO: string.split() — needs the Sass bracketed-list result shape.
