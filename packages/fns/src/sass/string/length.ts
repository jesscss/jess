import { defineFunction, makeDimension } from '@jesscss/core/value';
import { STRING_KINDS, codePoints, stringText } from './util.js';

/**
 * Sass `string.length()` — the `str-length()` global.
 *
 * Counts UNICODE CODE POINTS, not UTF-16 code units: dart-sass 1.101.0 answers
 * `string.length("👭")` with `1` and `str-length("a😊b")` with `3`. A combining
 * sequence still counts each code point separately (`"é"` → `2`).
 * Non-string arguments error (`str-length(10px)`), enforced by `kinds`.
 */
const length = defineFunction('length', {
  params: [{ name: 'string', kinds: STRING_KINDS }] as const,
  body: string => makeDimension(codePoints(stringText(string)).length)
});

export default length;
