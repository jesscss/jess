import { describe, expect, it } from 'vitest';
import { parse, safeParse } from '@jesscss/less-parser';

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
 * alike (owner ruling P33, 2026-09-23): a leading slash (jess#235). An uncalled
 * mixin reference such as `.a` (jess#236) is rejected in a property; in a
 * variable it is the value (owner 2026-10-29: "No, it's a mixin reference.").
 * The diagnostic must sit on the offending token and name the cause, not report
 * a generic failure earlier in the statement.
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
    ['a hex-letter namespace in a property', '.x { p: #abc.m; }', 8, '#abc.m'],
    ['a property', '.x { p: .a; }', 8, '.a']
  ])('names an uncalled mixin reference in %s (jess#236)', (_label, source, offset, name) => {
    expect(failureOf(source)).toMatchObject({
      code: 'parse/uncalled-mixin-reference',
      offset,
      fix: `Call it as ${name}() to use its result, or write ~"${name}" to keep it as text.`
    });
  });

  it.each([
    ['a mixin', '@foo: .a;', '.a', []],
    ['a mixin followed by a ruleset', '@foo: .a;\n.bar { color: red; }', '.a', []],
    ['a namespaced mixin', '@foo: #ns.a;', '.a', ['#ns']],
    ['a child-combined namespaced mixin', '@foo: #ns > .a;', '.a', ['#ns']],
    ['a namespace spelled in hex letters', '@x: #add.m;', '.m', ['#add']],
    ['a reference spaced from its semicolon', '@foo: .a ;', '.a', []]
  ])('keeps an uncalled reference to %s as a variable value (jess#236)', (_label, source, name, path) => {
    const [declaration] = parse(source).rules;
    expect(declaration).toMatchObject({
      type: 'VariableDeclaration',
      value: {
        type: 'Reference',
        base: { type: 'MixinCall', name, args: [], path: path.map(selector => ({ selector })) },
        steps: []
      }
    });
  });

  /*
   * Owner 2026-10-29: "I think .a !important is meaningless as a construction".
   * It parses (P45), and the error sits on the `!important`, not the `:`.
   */
  it.each([
    ['a mixin reference', '.m() { a: b; }\n@foo: .a !important;', 2, 10, 20],
    ['a spaced priority', '@foo: .a ! important;', 1, 10, 21],
    ['a namespaced mixin reference', '@foo: #ns.a !important;', 1, 13, 23],
    ['a child-combined namespaced mixin reference', '@foo: #ns > .a !important;', 1, 16, 26]
  ])('reports !important after %s in a variable at the !important', (_label, source, line, column, endColumn) => {
    const result = safeParse('entry.less', source);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'parse/important-on-mixin-reference',
      message: 'A mixin reference cannot carry !important.',
      line,
      column,
      endLine: line,
      endColumn
    });
  });

  it.each([
    ['a mixin call marked important as a statement', '.m() { a: b; }\n.x { .m() !important; }'],
    ['a variable holding a mixin call marked important', '.m() { a: b; }\n@foo: .m() !important;'],
    ['a variable holding a namespaced mixin call marked important', '@foo: #ns.m() ! important;']
  ])('keeps %s', (_label, source) => {
    expect(failureOf(source)).toBeUndefined();
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
    '@x: .a().b !important;',
    '@x: .a().b() !important;',
    '@x: .a() .b !important;',
    '@x: .a()() !important;',
    '@x: .a() ( 1 ) !important;',
    '@x: .a()[x] !important;',
    '.x { p: 12px/1.5; }'
  ])('still parses the valid neighbour %j', (source) => {
    expect(failureOf(source)).toBeUndefined();
  });
});
