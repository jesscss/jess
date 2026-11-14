import { define, checkKinds } from '@jesscss/core/value';
import { STRING_KINDS, asciiCase, reString, stringText, type SassString } from './util.js';

/**
 * Sass `string.to-lower-case()` / the `to-lower-case()` global.
 *
 * dart-sass 1.101.0: `to-lower-case("ABC")` → `"abc"`, `to-lower-case(ABC)` →
 * `abc`, and ASCII-only like its upper-case twin (`to-lower-case("ÄÖÜ")` → `"ÄÖÜ"`).
 */
const toLowerCase = define('to-lower-case', {
  params: [{ type: STRING_KINDS, check: checkKinds, name: 'string' }] as const,
  body: (string: SassString) => reString(string, asciiCase(stringText(string), false))
});

export default toLowerCase;
