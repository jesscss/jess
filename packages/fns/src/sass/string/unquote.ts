import { defineFunction, makeKeyword } from '@jesscss/core/value';
import { STRING_KINDS, stringText } from './util.js';

/**
 * Sass `string.unquote()` / the `unquote()` global.
 *
 * dart-sass 1.101.0: `unquote("hello")` → `hello`, `unquote(hello)` → `hello`,
 * `unquote("a b")` → `a b`, `unquote("hello world")` → `hello world`. The result
 * is an unquoted string even when its text is not a valid identifier.
 */
const unquote = defineFunction('unquote', {
  params: [{ name: 'string', kinds: STRING_KINDS }] as const,
  body: string => (string.type === 'Keyword' ? string : makeKeyword(stringText(string)))
});

export default unquote;
