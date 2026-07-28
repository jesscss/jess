import { defineFunction } from '@jesscss/core/value';
import { STRING_KINDS, codePoints, codepointForIndex, requireIntIndex, reString, stringText } from './util.js';

/**
 * Sass `string.slice()` — the `str-slice()` global.
 *
 * One-based and INCLUSIVE on both ends, indexed by code point, quoting taken
 * from `$string`. `$end-at` defaults to `-1` (the last character). Verified
 * against dart-sass 1.101.0:
 *
 * ```
 * str-slice("Hello", 2, 4)  → "ell"     str-slice("Hello", 1, 0)   → ""
 * str-slice("Hello", 2)     → "ello"    str-slice("Hello", 4, 2)   → ""
 * str-slice("Hello", -3)    → "llo"     str-slice("Hello", -100)   → "Hello"
 * str-slice("Hello", 2, -2) → "ell"     str-slice("Hello", 2, 100) → "ello"
 * str-slice("Hello", 0)     → "Hello"   str-slice("Hello", 6)      → ""
 * str-slice(Hello, 2, 4)    → ell       str-slice("😊abc", 1, 2)   → "😊a"
 * ```
 */
const slice = defineFunction('slice', {
  params: [
    { name: 'string', kinds: STRING_KINDS },
    { name: 'start-at', kinds: ['Dimension'] },
    { name: 'end-at', kinds: ['Dimension'], optional: true }
  ] as const,
  body: (string, startAt, endAt) => {
    const chars = codePoints(stringText(string));
    const start = requireIntIndex('start-at', startAt.number, startAt.unit);
    const end = endAt === undefined ? -1 : requireIntIndex('end-at', endAt.number, endAt.unit);

    // Whatever the start is, an end index of 0 selects nothing.
    if (end === 0) {
      return reString(string, '');
    }
    const startIndex = codepointForIndex(start, chars.length);
    let endIndex = codepointForIndex(end, chars.length, true);
    if (endIndex === chars.length) {
      endIndex -= 1;
    }
    return reString(string, endIndex < startIndex ? '' : chars.slice(startIndex, endIndex + 1).join(''));
  }
});

export default slice;
