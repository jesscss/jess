import { defineFunction } from '@jesscss/core/value';
import { STRING_KINDS, asciiCase, reString, stringText } from './util.js';

/**
 * Sass `string.to-upper-case()` / the `to-upper-case()` global.
 *
 * dart-sass 1.101.0: `to-upper-case("aBc")` → `"ABC"`, `to-upper-case(aBc)` →
 * `ABC` (quoting preserved), and the mapping is ASCII-ONLY —
 * `to-upper-case("straße")` → `"STRAßE"`, `to-upper-case("ä")` → `"ä"`.
 */
const toUpperCase = defineFunction('to-upper-case', {
  params: [{ name: 'string', kinds: STRING_KINDS }] as const,
  body: string => reString(string, asciiCase(stringText(string), true))
});

export default toUpperCase;
