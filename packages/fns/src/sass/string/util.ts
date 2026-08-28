/**
 * Shared facts for the `sass:string` module.
 *
 * Sass has ONE string type with a quoting flag; the value domain splits that into
 * `Quoted` (the flag is on) and `Keyword` (the flag is off). Every string function
 * therefore reads through {@link stringText} and rebuilds through
 * {@link reString}, which preserves the argument's quoting exactly as dart-sass
 * does (`str-slice(Hello,2,4)` → `ell`, `str-slice("Hello",2,4)` → `"ell"`).
 *
 * Indexing is by UNICODE CODE POINT, not UTF-16 code unit: dart-sass answers
 * `str-length("😊")` with `1` and `str-index("😊abc","abc")` with `2`.
 */
import type { Keyword, Quoted } from '@jesscss/core';
import { makeKeyword, makeQuoted, NULL } from '@jesscss/core';

/** The two value-domain shapes a Sass string arrives as. */
export type SassString = Quoted | Keyword;

/** The param `type` every `sass:string` string slot declares. */
export const STRING_KINDS = ['Quoted', 'Keyword'] as const;

/**
 * Sass's `null`. The value domain has no constructor for it (nothing else
 * produces one yet), so the single instance lives here; `string.index` is its
 * only producer. Its bytes are empty — jess emits `b: ;` where dart-sass DROPS
 * the whole declaration, a serializer-level difference this module cannot reach.
 */
export { NULL };

/** A Sass string's characters, with its quoting flag discarded. */
export const stringText = (value: SassString): string =>
  value.type === 'Quoted' ? value.value : value.text;

/**
 * dart-sass's quote-character choice when it has to ADD quotes: `"` unless the
 * text contains a `"` and no `'` (then `'`, so nothing needs escaping). A text
 * carrying both is emitted double-quoted with its `"` backslash-escaped, since
 * the value serializer writes the payload verbatim.
 */
export function addQuotes(text: string): Quoted {
  if (!text.includes('"')) {
    return makeQuoted(text, '"', false);
  }
  return text.includes('\'')
    ? makeQuoted(text.split('"').join('\\"'), '"', false)
    : makeQuoted(text, '\'', false);
}

/** Rebuild a derived string with the SOURCE string's quoting (dart-sass rule). */
export const reString = (source: SassString, text: string): SassString =>
  source.type === 'Quoted' ? makeQuoted(text, source.quote, source.escaped) : makeKeyword(text);

/** A string's code points — the unit every Sass string index counts in. */
export const codePoints = (text: string): string[] => Array.from(text);

/** Reject the non-integer / united index dart-sass rejects (`$index: 1.5 is not an int`). */
export function requireIntIndex(name: string, number: number, unit: string): number {
  if (unit !== '') {
    throw new TypeError(`$${name}: Expected ${number}${unit} to have no units.`);
  }
  if (!Number.isInteger(number)) {
    throw new TypeError(`$${name}: ${number} is not an int.`);
  }
  return number;
}

/**
 * dart-sass `_codepointForIndex`: turn a one-based Sass string index into the
 * zero-based code-point offset the slice/insert bodies use. `0` pins to the
 * start; a positive index is clamped to the length; a negative index counts back
 * from the end and clamps to `0` unless the caller allows the negative result
 * through (the `$end-at` slot, which uses it to detect an empty range).
 */
export function codepointForIndex(index: number, length: number, allowNegative = false): number {
  if (index === 0) {
    return 0;
  }
  if (index > 0) {
    return Math.min(index - 1, length);
  }
  const result = length + index;
  return result < 0 && !allowNegative ? 0 : result;
}

/** ASCII-only case mapping — dart-sass leaves `ä`/`ß` alone (`to-upper-case("straße")` → `"STRAßE"`). */
export function asciiCase(text: string, upper: boolean): string {
  const lo = upper ? 0x61 : 0x41;
  const hi = upper ? 0x7a : 0x5a;
  const shift = upper ? -32 : 32;
  let out = '';
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    out += code >= lo && code <= hi ? String.fromCharCode(code + shift) : text[index]!;
  }
  return out;
}
