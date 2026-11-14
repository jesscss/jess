/**
 * The `sass:string` members that are also reachable as deprecated GLOBAL
 * functions, under their global names.
 *
 * Five members keep their name as a global (`quote`, `unquote`,
 * `to-upper-case`, `to-lower-case`, `unique-id`) and are re-exported from the
 * module index unchanged. The other four are renamed, and a registry keys on
 * `fn.name`, so each gets its own callable that hands its arguments to the
 * module member — no logic is duplicated and no name is overloaded.
 */
import { defineFunction } from '@jesscss/core/value';
import insert from './insert.js';
import length from './length.js';
import slice from './slice.js';
import stringIndex from './string-index.js';

export { default as quote } from './quote.js';
export { default as unquote } from './unquote.js';
export { default as toUpperCase } from './to-upper-case.js';
export { default as toLowerCase } from './to-lower-case.js';
export { default as uniqueId } from './unique-id.js';

/** `str-length($string)` — the global spelling of `string.length()`. */
export const strLength = defineFunction('str-length', { params: length.params, variadic: true, body: (args, ctx) => length(args, ctx) });

/** `str-index($string, $substring)` — the global spelling of `string.index()`. */
export const strIndex = defineFunction('str-index', { params: stringIndex.params, variadic: true, body: (args, ctx) => stringIndex(args, ctx) });

/** `str-slice($string, $start-at, $end-at: -1)` — the global spelling of `string.slice()`. */
export const strSlice = defineFunction('str-slice', { params: slice.params, variadic: true, body: (args, ctx) => slice(args, ctx) });

/** `str-insert($string, $insert, $index)` — the global spelling of `string.insert()`. */
export const strInsert = defineFunction('str-insert', { params: insert.params, variadic: true, body: (args, ctx) => insert(args, ctx) });
