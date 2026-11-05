import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * A rule in a rule: https://sass-lang.com/documentation/style-rules/#nesting.
 * Every expectation is what `sass --no-source-map` 1.101.7 writes for the source,
 * except where a test names the compile error Jess gives for punctuation no value
 * accepts. The first source is Foundation 6.9.0's `docs/assets/scss/docs.scss`.
 */
const cases: ReadonlyArray<readonly [string, string, string]> = [
  ['a pseudo-class argument', '.a { li:not(:last-child) { c: d; } }', '.a li:not(:last-child) {\n  c: d;\n}\n'],
  ['a class argument', '.a { li:not(.b) { c: d; } }', '.a li:not(.b) {\n  c: d;\n}\n'],
  ['a relative argument', '.a { li:has(> b) { c: d; } }', '.a li:has(> b) {\n  c: d;\n}\n'],
  ['a compound argument', '.a { li:not(a:hover) { c: d; } }', '.a li:not(a:hover) {\n  c: d;\n}\n'],
  ['a combinator after it', '.a { li:is(.b):hover > .c:not(:first-child) { d: e; } }', '.a li:is(.b):hover > .c:not(:first-child) {\n  d: e;\n}\n'],
  ['a sibling after it', '.a { li:is(.b) ~ .c:not(.d) { e: f; } }', '.a li:is(.b) ~ .c:not(.d) {\n  e: f;\n}\n'],
  ['`not` over a map in a value', '.a { x: not(a:hover); }', '.a {\n  x: false;\n}\n']
];

describe('nested rule that opens with a functional pseudo', () => {
  it.each(cases)('%s', async (_label, source, css) => {
    expect(await new Compiler({ output: { collapseNesting: true } }).renderString(source, { extension: '.scss' })).toBe(css);
  });

  it('reports punctuation no value accepts where the argument is a value', async () => {
    await expect(new Compiler().renderString('.a { x: f(.d); }', { extension: '.scss' })).rejects.toThrow('`.` is not valid in any CSS value');
  });
});

const compile = (source: string) => new Compiler({ output: { collapseNesting: true } }).renderString(source, { extension: '.scss' });

/* Each expectation is what `sass --no-source-map` 1.101.7 writes. */
describe('a sign before a call argument stays a sign', () => {
  it.each([
    ['calc(+1px + 2px)', 'a { b: calc(+1px + 2px); }', 'a {\n  b: 3px;\n}\n'],
    ['calc(+ 1px + 2px)', 'a { b: calc(+ 1px + 2px); }', 'a {\n  b: 3px;\n}\n'],
    ['abs(+1)', 'a { b: abs(+1); }', 'a {\n  b: 1;\n}\n'],
    ['abs(+ 1)', 'a { b: abs(+ 1); }', 'a {\n  b: 1;\n}\n'],
    ['percentage(+$a)', '$a: 2; a { b: percentage(+$a); }', 'a {\n  b: 200%;\n}\n'],
    ['max(+1, 2)', 'a { b: max(+1, 2); }', 'a {\n  b: 2;\n}\n'],
    ['rgb(+1,2,3)', 'a { b: rgb(+1,2,3); }', 'a {\n  b: rgb(1, 2, 3);\n}\n'],
    ['nth($l, +1)', '$l: 1 2; a { b: nth($l, +1); }', 'a {\n  b: 1;\n}\n'],
    ['a user function', '@function f($b) { @return $b * 2; } a { x: f(+1); }', 'a {\n  x: 2;\n}\n'],
    ['a comparison', '@function f($v) { @return $v; } a { b: f(+1 == 1); }', 'a {\n  b: true;\n}\n']
  ])('%s', async (_label, source, css) => {
    expect(await compile(source)).toBe(css);
  });

  it('math.div(+1, 2)', async () => {
    expect(await compile('@use "sass:math"; a { b: math.div(+1, 2); }')).toBe('a {\n  b: 0.5;\n}\n');
  });
});

/* None of these is a value `sass` writes either: each is the delim css reads, or its punctuation error. */
describe('a delim that opens a call argument', () => {
  it.each(['%2', '~2', '<2', '>2'])('foo(%s) is invalid punctuation', async (argument) => {
    await expect(compile(`a { b: foo(${argument}); }`)).rejects.toMatchObject({ code: 'css/invalid-value-punctuation' });
  });

  it('foo(*2) keeps its bytes', async () => {
    expect(await compile('a { b: foo(*2); }')).toBe('a {\n  b: foo(*2);\n}\n');
  });

  it('writes no comment for the padding of a sign', async () => {
    expect(await compile('a { b: abs(+ /* c */ 1); }')).toBe('a {\n  b: 1;\n}\n');
  });
});

describe('a pseudo that opens like a declaration', () => {
  it.each([
    ['an empty argument', '.a { x:f() .b { c: d } }', '.a x:f() .b {\n  c: d;\n}\n'],
    ['a combinator after it', '.a { x:f() > .b { c: d } }', '.a x:f() > .b {\n  c: d;\n}\n'],
    ['a list after it', '.a { x:f() .b, .c { c: d } }', '.a x:f() .b,\n.a .c {\n  c: d;\n}\n'],
    ['a property with its value empty', '.a { background:url() .c { c: d } }', '.a background:url() .c {\n  c: d;\n}\n'],
    ['var()', '.a { x:var() .c { c: d } }', '.a x:var() .c {\n  c: d;\n}\n']
  ])('%s', async (_label, source, css) => {
    expect(await compile(source)).toBe(css);
  });

  it.each([
    ['.a {\n  x:not(1) .b { c: d }\n}', 2, 4],
    ['.a {\n  x:not("s") { c: d }\n}', 2, 4],
    ['.a {\n  x:has(1) .b { c: d }\n}', 2, 4],
    ['.a {\n  x:nth-child() .b { c: d }\n}', 2, 4],
    ['.a {\n  x:not() .b { c: d }\n}', 2, 4],
    ['.a {\n  x:has() .b { c: d }\n}', 2, 4],
    ['li:not(1) { c: d; }', 1, 3]
  ])('%s is a located error, and the document continues', async (source, line, column) => {
    await expect(compile(source)).rejects.toMatchObject({ code: 'parse/invalid-rule-prelude', line, column });
  });
});
