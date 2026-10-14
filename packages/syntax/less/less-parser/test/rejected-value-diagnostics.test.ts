import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/less-parser';

/** The typed failure `parse()` throws, or `undefined` when the source parses. */
function failureOf(source: string): unknown {
  try {
    parse(source);
    return undefined;
  } catch (error) {
    return error;
  }
}

/*
 * A punctuation-led value is rejected in Less, in a variable and in a property
 * alike (owner ruling P33, 2026-09-23): a leading slash (jess#235) and an
 * uncalled mixin reference such as `.a` (jess#236) both. The diagnostic must sit
 * on the offending token and name the cause, not report a generic failure
 * earlier in the statement.
 */
describe('punctuation-led Less values are rejected at their first token', () => {
  it.each([
    ['a variable', '@p: /img/icon.svg;', 4],
    ['a variable, unspaced', '@p:/img/icon.svg;', 3],
    ['a property', '.x { p: /img; }', 8],
    ['the last property of a block', '.x { p: /img }', 8],
    ['a property inside a mixin', '.m() { p: /img/a.svg; }', 10]
  ])('names a leading slash in %s (jess#235)', (_label, source, offset) => {
    expect(failureOf(source)).toMatchObject({
      code: 'parse/leading-separator-value',
      offset,
      message: 'A Less value cannot start with "/".'
    });
  });

  it.each([
    ['a variable', '@foo: .a;', 6, '.a'],
    ['a variable followed by a ruleset', '@foo: .a;\n.bar { color: red; }', 6, '.a'],
    ['a namespaced variable', '@foo: #ns.a;', 6, '#ns.a'],
    ['a namespace spelled in hex letters', '@x: #add.m;', 4, '#add.m'],
    ['a hex-letter namespace in a property', '.x { p: #abc.m; }', 8, '#abc.m'],
    ['a property', '.x { p: .a; }', 8, '.a'],
    ['a reference spaced from its semicolon', '@foo: .a ;', 6, '.a']
  ])('names an uncalled mixin reference in %s (jess#236)', (_label, source, offset, name) => {
    expect(failureOf(source)).toMatchObject({
      code: 'parse/uncalled-mixin-reference',
      offset,
      fix: `Call it as ${name}() to use its result, or write ~"${name}" to keep it as text.`
    });
  });

  it.each([
    ['a mistyped colour', '.test { color: #fffff; }'],
    ['a called mixin in a property', '.x { p: .a(); }'],
    ['a called namespaced mixin in a property', '.x { a: #ns > .m(); }']
  ])('keeps %s on the ordinary value failure', (_label, source) => {
    expect(failureOf(source)).toMatchObject({ code: 'parse/syntax-error' });
  });

  it.each([
    '@p: ~"/img/icon.svg";',
    '@p: url(/img/icon.svg);',
    '@p: "/img/icon.svg";',
    '--p: /img/icon.svg;',
    '.x { --p: /img; }',
    '@p: /* lead */ red;',
    '@p: // lead\n  red;',
    '.x { p: /* lead */ red; }',
    '@x: .5;',
    '@c: #fff;',
    '@c: #add;',
    '@x: #add.m();',
    '@x: #add[@k];',
    '@foo: .a();',
    '@foo: #ns.a();',
    '@foo: .a[@x];',
    '.x { p: 12px/1.5; }'
  ])('still parses the valid neighbour %j', (source) => {
    expect(failureOf(source)).toBeUndefined();
  });
});
