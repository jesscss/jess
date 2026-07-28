import { defineFunction } from '@jesscss/core/value';
import { STRING_KINDS, addQuotes, stringText } from './util.js';

/**
 * Sass `string.quote()` / the `quote()` global.
 *
 * dart-sass 1.101.0: `quote(hello)` → `"hello"`, `quote("hello")` → `"hello"`,
 * `quote("a'b")` → `"a'b"`, `quote("")` → `""`. A non-string argument is an
 * error (`quote(10px)`, `quote(#fff)`, `quote(red)`, `quote(a b)` all raise
 * `$string: … is not a string.`), which the `kinds` spec enforces.
 */
const quote = defineFunction('quote', {
  params: [{ name: 'string', kinds: STRING_KINDS }] as const,
  body: string => addQuotes(stringText(string))
});

export default quote;
