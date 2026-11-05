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
  ['an id argument', '.a { li:is(#foo) { c: d; } }', '.a li:is(#foo) {\n  c: d;\n}\n'],
  ['a universal argument', '.a { li:not(*) { c: d; } }', '.a li:not(*) {\n  c: d;\n}\n'],
  ['a relative argument', '.a { li:has(> b) { c: d; } }', '.a li:has(> b) {\n  c: d;\n}\n'],
  ['an unknown pseudo', '.a { li:foo(.b) { c: d; } }', '.a li:foo(.b) {\n  c: d;\n}\n'],
  ['a compound argument', '.a { li:not(a:hover) { c: d; } }', '.a li:not(a:hover) {\n  c: d;\n}\n'],
  ['a nested compound argument', '.a { li:not(a:not(b:hover)) { c: d; } }', '.a li:not(a:not(b:hover)) {\n  c: d;\n}\n'],
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
