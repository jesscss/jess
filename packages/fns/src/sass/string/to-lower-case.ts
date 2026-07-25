import { defineFunction } from '@jesscss/core/value';
import { STRING_KINDS, asciiCase, reString, stringText } from './util.js';

/**
 * Sass `string.to-lower-case()` / the `to-lower-case()` global.
 *
 * dart-sass 1.101.0: `to-lower-case("ABC")` → `"abc"`, `to-lower-case(ABC)` →
 * `abc`, and ASCII-only like its upper-case twin (`to-lower-case("ÄÖÜ")` → `"ÄÖÜ"`).
 */
const toLowerCase = defineFunction('to-lower-case', {
  params: [{ name: 'string', kinds: STRING_KINDS }] as const,
  body: string => reString(string, asciiCase(stringText(string), false))
});

export default toLowerCase;
