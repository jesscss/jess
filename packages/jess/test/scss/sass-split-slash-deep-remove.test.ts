import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { jessFunctions } from '@jesscss/plugin-scss';
import { parse as parseScss } from '@jesscss/scss-parser';
import { Compiler } from '../../src/index.js';

/*
 * `string.split`, `list.slash` and `map.deep-remove` through the `.scss`
 * compile path (ledger C6: every Sass function behaviour-complete; P51: Sass
 * functions measured against Dart Sass 1.101.7). The cases are sass-spec's
 * (`spec/core_functions/string/split.hrx`, `list/slash.hrx`,
 * `map/deep_remove.hrx`) plus edges probed against Dart Sass; each expected value
 * is Dart Sass's output, or the message of the error it stops on. Slash lists
 * are written spaced (V12). None of the three has a global spelling in Dart
 * Sass, so none is registered as one (`global-aliases.test.ts`).
 */
const source = (expression: string): string => `@use "sass:string";\n@use "sass:list";\n@use "sass:map";\n.x { r: ${expression}; }`;
const render = async (expression: string, extension: '.scss' | '.jess' = '.scss'): Promise<string> => {
  const scss = extension === '.scss' ? source(expression) : expression;
  try {
    const css = await new Compiler({ compile: { functionMode: 'error' } }).renderString(scss, { extension });
    return /r: ([^;]*);/u.exec(css)?.[1] ?? '';
  } catch (error) {
    const message = String(error);
    return `ERROR ${/could not be evaluated: (.*)/u.exec(message)?.[1] ?? message}`;
  }
};

/*
 * The argument-count and argument-type errors are core's dispatcher's, in its
 * own words, for every built-in; Dart Sass's wording for those is not this
 * change's. Each such case maps Dart Sass's message to the dispatcher's, and
 * asserts the dispatcher's, so the case still proves the call reached this
 * function. Every message a function body owns is Dart Sass's, word for word.
 */
const DISPATCH_ERRORS = new Map([
  ['$separator: 1 is not a string.', 'split: arg 1 expected Quoted|Keyword, got Dimension'],
  ['$string: 1 is not a string.', 'split: arg 0 expected Quoted|Keyword, got Dimension'],
  ['$limit: "1" is not a number.', 'split: arg 2 expected Dimension|Null, got Quoted'],
  ['Only 3 arguments allowed, but 4 were passed.', 'split: too many arguments'],
  ['Missing argument $separator.', 'split: missing required argument separator'],
  ['$map: 1 is not a map.', 'deep-remove: arg 0 expected Collection, got Dimension'],
  ['Missing argument $key.', 'deep-remove: missing required argument key']
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
  ['string.split("a/b/c", "/", 1px)', '["a", "b/c"]'],
  ['string.split("a/b/c", "/", 1.000000000001)', '["a", "b/c"]'],
  ['string.split("a/b/c", "/", 1.5px)', 'ERROR $limit: 1.5px is not an int.'],
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
  ['list.slash(c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, s, t, u, v, w, x, y, z)', 'c / d / e / f / g / h / i / j / k / l / m / n / o / p / q / r / s / t / u / v / w / x / y / z'],
  ['list.separator(list.slash(c, d))', 'slash'],
  ['list.slash(c)', 'ERROR At least two elements are required.'],

  // map.deep-remove
  ['map.has-key(map.deep-remove((c: (d: e)), c, e), c, d)', 'true'],
  ['map.has-key(map.deep-remove((c: (d: e)), c, d, e), c, d)', 'true'],
  ['map.has-key(map.deep-remove((c: (d: e)), c, d, e, f, g), c, d)', 'true'],
  ['list.length(map.deep-remove((), 1))', '0'],
  ['type-of(map.deep-remove((), 1))', 'map'],
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
    const dispatcher = DISPATCH_ERRORS.get(expected.slice('ERROR '.length));
    expect(await render(expression)).toBe(dispatcher === undefined ? expected : `ERROR ${dispatcher}`);
  });
});

/*
 * The same cells through the converter: `.scss` → `.jess` → CSS writes what
 * `.scss` → CSS writes. A call with keyword arguments is left out: the converter
 * does not lower one yet (`keyword or spread argument`), for any call.
 */
const SASS_FUNCTIONS = jessFunctions();
describe('scss → .jess → css writes what scss → css writes', () => {
  it.each(CASES.filter(([expression, expected]) => !expected.startsWith('ERROR ') && !expression.includes('$')))('%s', async (expression, expected) => {
    expect(await render(emitJess(parseScss(source(expression)), { functions: SASS_FUNCTIONS }), '.jess')).toBe(expected);
  });
});

/*
 * Known gaps this change surfaces but does not own, pinned with `it.fails` so a
 * fix shows here.
 *
 * - A string's escapes are not decoded before it is split (`string/util.ts`
 *   `stringText` reads the raw payload, for every `sass:string` function), so a
 *   split can cut an escape in two and write an unterminated string. CSS Syntax
 *   3 §4.3.7: an escape is one code point. The first case is sass-spec's
 *   `private_use_character`.
 * - An empty list inside a computed list is written as an empty item, where the
 *   same value written by the author fails the compile (`((), 9)` is
 *   `eval/empty-list-value`, P51/P37). Whether the computed one fails too or is
 *   left out, as Dart Sass leaves it out, is open for the owner; the pin expects
 *   the authored value's failure.
 */
const GAPS: ReadonlyArray<readonly [string, string]> = [
  ['string.split("\\E000", "")', '["\\e000"]'],
  ['string.split("a\\"b", \'"\')', '["a", "b"]'],
  ['list.slash(c, ())', 'ERROR'],
  ['list.slash(c, (), d)', 'ERROR']
];

describe('scss: string.split, list.slash and map.deep-remove — known gaps', () => {
  it.fails.each(GAPS)('%s', async (expression, expected) => {
    const actual = await render(expression);
    expect(expected === 'ERROR' ? actual.startsWith('ERROR ') : actual).toBe(expected === 'ERROR' ? true : expected);
  });
});
