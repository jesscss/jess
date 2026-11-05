import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * Each expectation is what `sass --no-source-map` 1.101.7 writes for the source
 * (https://sass-lang.com/documentation/at-rules/function/#taking-arbitrary-arguments).
 * The forwarding spelling is Bootstrap 5.3.8's `_functions.scss`.
 */
const cases: ReadonlyArray<readonly [string, string]> = [
  ['@function f($a, $b) { @return $b; } $l: 1 2; .a { b: f($l...); }', '.a {\n  b: 2;\n}\n'],
  ['@function f($a, $b, $c) { @return $c; } $l: 2 3; .a { b: f(1, $l...); }', '.a {\n  b: 3;\n}\n'],
  ['@function f($a...) { @return nth($a, 1); } @function g($m...) { @return f(1, $m...); } .a { b: g(); }', '.a {\n  b: 1;\n}\n'],
  ['@function f($a...) { @return length($a); } @function g($m...) { @return f($m...); } .a { b: g(1, 2, 3); }', '.a {\n  b: 3;\n}\n'],
  ['@function f($a, $b) { @return darken($b, 10%); } $l: 1, red; .a { b: f($l...); }', '.a {\n  b: #cc0000;\n}\n'],
  ['@function f($a, $b) { @return $b + 1px; } $l: 1, 2px; .a { b: f($l...); }', '.a {\n  b: 3px;\n}\n'],
  ['$l: 1 2; .a { b: max($l...); }', '.a {\n  b: 2;\n}\n'],
  ['$l: (1 2 3 4) 2; .a { b: nth($l...); }', '.a {\n  b: 2;\n}\n'],
  ['$l: 1 2; .a { b: rgb(1, $l...); }', '.a {\n  b: rgb(1, 1, 2);\n}\n'],
  ['$l: 1 2; .a { b: foo($l...); }', '.a {\n  b: foo(1 2);\n}\n']
];

describe('a rest argument to a function', () => {
  it.each(cases)('%s', async (source, css) => {
    expect(await new Compiler().renderString(source, { extension: '.scss' })).toBe(css);
  });
});
