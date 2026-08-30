/**
 * The `sass:string` members that are also reachable as deprecated GLOBAL
 * functions, under their global names.
 *
 * Five members keep their name as a global (`quote`, `unquote`,
 * `to-upper-case`, `to-lower-case`, `unique-id`) and are re-exported from the
 * module index unchanged. The other four are renamed, and a registry keys on
 * `fn.name`, so each gets its own callable that delegates to the single body in
 * the module file — no logic is duplicated and no name is overloaded.
 */
import { defineFunction } from '@jesscss/core';
import insert from './insert.js';
import length from './length.js';
import slice from './slice.js';
import stringIndex from './string-index.js';
import type { Dimension } from '@jesscss/core';
import { STRING_KINDS, type SassString } from './util.js';

export { default as quote } from './quote.js';
export { default as unquote } from './unquote.js';
export { default as toUpperCase } from './to-upper-case.js';
export { default as toLowerCase } from './to-lower-case.js';
export { default as uniqueId } from './unique-id.js';

/** `str-length($string)` — the global spelling of `string.length()`. */
export const strLength = defineFunction('str-length', {
  params: [{ name: 'string', type: STRING_KINDS }] as const,
  body: (string: SassString) => length(string)
});

/** `str-index($string, $substring)` — the global spelling of `string.index()`. */
export const strIndex = defineFunction('str-index', {
  params: [
    { name: 'string', type: STRING_KINDS },
    { name: 'substring', type: STRING_KINDS }
  ] as const,
  body: (string: SassString, substring: SassString) => stringIndex(string, substring)
});

/** `str-slice($string, $start-at, $end-at: -1)` — the global spelling of `string.slice()`. */
export const strSlice = defineFunction('str-slice', {
  params: [
    { name: 'string', type: STRING_KINDS },
    { name: 'start-at', type: 'Dimension' },
    { name: 'end-at', type: 'Dimension', optional: true }
  ] as const,
  body: (string: SassString, startAt: Dimension, endAt: Dimension | undefined) => (endAt === undefined ? slice(string, startAt) : slice(string, startAt, endAt))
});

/** `str-insert($string, $insert, $index)` — the global spelling of `string.insert()`. */
export const strInsert = defineFunction('str-insert', {
  params: [
    { name: 'string', type: STRING_KINDS },
    { name: 'insert', type: STRING_KINDS },
    { name: 'index', type: 'Dimension' }
  ] as const,
  body: (string: SassString, insertValue: SassString, index: Dimension) => insert(string, insertValue, index)
});
