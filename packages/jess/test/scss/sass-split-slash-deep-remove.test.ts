import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/*
 * `string.split`, `list.slash` and `map.deep-remove` through the `.scss`
 * compile path. Each case is a sass-spec case (`spec/core_functions/string/
 * split.hrx`, `list/slash.hrx`, `map/deep_remove.hrx`); the expected value is
 * Dart Sass 1.101.7's output, or the message of the error it stops on. None of
 * the three has a global spelling in Dart Sass, so each global name is
 * unresolved and written out as-is.
 */
const render = async (expression: string): Promise<string> => {
  const scss = `@use "sass:string";\n@use "sass:list";\n@use "sass:map";\n.x { r: ${expression}; }`;
  try {
    const css = await new Compiler({ compile: { functionMode: 'error' } }).renderString(scss, { extension: '.scss' });
    return /r: ([^;]*);/u.exec(css)?.[1] ?? '';
  } catch (error) {
    const message = String(error);
    return `ERROR ${/could not be evaluated: (.*)/u.exec(message)?.[1] ?? message}`;
  }
};

/*
 * The argument-count and argument-type errors are core's dispatcher's, in its
 * own words (`split: arg 1 expected Quoted|Keyword, got Dimension`), for every
 * built-in; Dart Sass's wording for those is not this change's. Those cases
 * assert that the compile stops; every message a function body owns is Dart
 * Sass's, word for word.
 */
const DISPATCH_ERRORS = new Set([
  '$separator: 1 is not a string.',
  '$string: 1 is not a string.',
  '$limit: "1" is not a number.',
  'Only 3 arguments allowed, but 4 were passed.',
  'Missing argument $separator.',
  '$map: 1 is not a map.',
  'Missing argument $key.'
]);

const CASES: ReadonlyArray<readonly [string, string]> = [
  // string.split
  ['string.split("", "/")', '[]'],
  ['list.separator(string.split("", "/"))', 'comma'],
  ['string.split("a", "")', '["a"]'],
  ['list.separator(string.split("a", ""))', 'comma'],
  ['string.split("Helvetica", "")', '["H", "e", "l", "v", "e", "t", "i", "c", "a"]'],
  ['string.split("", "")', '[]'],
  ['string.split("a, b, c", ", ")', '["a", "b", "c"]'],
  ['string.split("a, b, c", "&")', '["a, b, c"]'],
  ['string.split("a, b, c, d", ", ", 2)', '["a", "b", "c, d"]'],
  ['string.split("👭a", "")', '["👭", "a"]'],
  ['string.split($string: "a/b/c", $separator: "/", $limit: 1)', '["a", "b/c"]'],
  ['string.split(abc, "")', '[a, b, c]'],
  ['string.split("a/b/c", "/", null)', '["a", "b", "c"]'],
  ['string.split("a/b/c", "", 1)', '["a", "/", "b", "/", "c"]'],
  ['list.length(string.split("a/b/c", "/"))', '3'],
  ['list.is-bracketed(string.split("a/b/c", "/"))', 'true'],
  ['string.split("1/2/3", 1)', 'ERROR $separator: 1 is not a string.'],
  ['string.split(1, "%")', 'ERROR $string: 1 is not a string.'],
  ['string.split("1/2/3", "/", 0.5)', 'ERROR $limit: 0.5 is not an int.'],
  ['string.split("1/2/3", "/", -1)', 'ERROR $limit: Must be 1 or greater, was -1.'],
  ['string.split("a, b, c", ", ", 0)', 'ERROR $limit: Must be 1 or greater, was 0.'],
  ['string.split("1/2/3", "/", "1")', 'ERROR $limit: "1" is not a number.'],
  ['string.split("a/b/c", "/", 1, 3)', 'ERROR Only 3 arguments allowed, but 4 were passed.'],
  ['string.split("a/b/c")', 'ERROR Missing argument $separator.'],

  // list.slash
  ['list.slash(c, d)', 'c / d'],
  ['list.slash(c, d, e)', 'c / d / e'],
  ['list.separator(list.slash(c, d))', 'slash'],
  ['list.slash(c)', 'ERROR At least two elements are required.'],

  // map.deep-remove
  ['map.has-key(map.deep-remove((c: (d: e)), c, e), c, d)', 'true'],
  ['map.has-key(map.deep-remove((c: (d: e)), c, d, e), c, d)', 'true'],
  ['map.has-key(map.deep-remove((c: (d: e)), c, d, e, f, g), c, d)', 'true'],
  ['map.keys(map.deep-remove((c: d), d))', 'c'],
  ['map.values(map.deep-remove((c: d), d))', 'd'],
  ['list.length(map.deep-remove((c: d), c))', '0'],
  ['map.has-key(map.deep-remove((c: (d: e)), c, d), c)', 'true'],
  ['map.has-key(map.deep-remove((c: (d: e)), c, d), c, d)', 'false'],
  ['list.length(list.nth(map.values(map.deep-remove((c: (d: e)), c, d)), 1))', '0'],
  ['map.keys(list.nth(map.values(map.deep-remove((c: (d: e, f: g, h: i)), c, d)), 1))', 'f, h'],
  ['map.keys(list.nth(map.values(map.deep-remove((c: (d: e, f: g, h: i)), c, f)), 1))', 'd, h'],
  ['map.keys(list.nth(map.values(map.deep-remove((c: (d: e, f: g, h: i)), c, h)), 1))', 'd, f'],
  ['map.keys(map.deep-remove((a: 1, c: (d: e)), c, d))', 'a, c'],
  ['map.deep-remove(1, 2)', 'ERROR $map: 1 is not a map.'],
  ['map.deep-remove((c: d))', 'ERROR Missing argument $key.']
];

describe('scss: string.split, list.slash and map.deep-remove do what Dart Sass does', () => {
  it.each(CASES)('%s', async (expression, expected) => {
    const actual = await render(expression);
    if (DISPATCH_ERRORS.has(expected.slice('ERROR '.length))) {
      expect(actual).toMatch(/^ERROR /u);
    } else {
      expect(actual).toBe(expected);
    }
  });
});
