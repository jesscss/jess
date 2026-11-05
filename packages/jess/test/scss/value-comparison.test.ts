import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * A comparison means the same in a value as in `@if`, with the precedence Sass
 * gives it: https://sass-lang.com/documentation/operators/#order-of-operations.
 * Every expectation is what `sass --no-source-map` 1.101.7 writes for the source.
 * Sources follow Bootstrap 5.3.8 `mixins/_utilities.scss` and `vendor/_rfs.scss`,
 * and Foundation 6.9.0's `util/_value.scss` and sassy-lists `_true.scss`.
 */
const cases: ReadonlyArray<readonly [string, string, string]> = [
  ['@return with `==`', '@function a($v) { @return $v == 1; } .a { b: a(1); c: a(2); }', '.a {\n  b: true;\n  c: false;\n}\n'],
  ['@return with `>` over a call', '@function a($m) { @return length($m) > 0; } .a { b: a(1 2); }', '.a {\n  b: true;\n}\n'],
  ['`and` over `==` in an argument', '$c: ""; $d: "-"; @function f($x) { @return $x; } $i: f($c == "" and $d == "-"); .a { b: $i; }', '.a {\n  b: true;\n}\n'],
  ['`or` over `and` in the if() test', '$a: 1; $b: 2; $s: if($a > 0 and $b > 0 or $a < 0 and $b < 0, 1, -1); .a { b: $s; }', '.a {\n  b: 1;\n}\n'],
  ['`not` over a paren group', '$a: null; $b: 1; @function g() { @return not ($a == null or $b); } .a { b: g(); }', '.a {\n  b: false;\n}\n'],
  ['`not(` over a comparison', 'a { b: not(e == f or (g == h)); c: not(1 == 1); }', 'a {\n  b: true;\n  c: false;\n}\n'],
  ['a paren group', '$a: null; $b: 2; $r: ($a == null or $b); .a { b: $r; }', '.a {\n  b: true;\n}\n'],
  ['each operator, glued and spaced', '.a { b: 1 == 1; c: 1 != 1; d: 1<2; e: 2 >= 3; f: a == a; g: "a" == a; h: 1 == 1px; }', '.a {\n  b: true;\n  c: false;\n  d: true;\n  e: false;\n  f: true;\n  g: true;\n  h: false;\n}\n'],
  ['`<` binds tighter than `==`', '.a { b: 1 == 1 < 2; }', '.a {\n  b: false;\n}\n'],
  ['a comparison binds tighter than a space list', '.a { b: a == b c; }', '.a {\n  b: false c;\n}\n'],
  ['mixin arguments', '@mixin m($a, $b) { c: $a; d: $b; } .a { @include m(1 == 1, 2 != 2); }', '.a {\n  c: true;\n  d: false;\n}\n'],
  ['a map value', '$m: ("a": 1 == 1); .b { c: map-get($m, "a"); }', '.b {\n  c: true;\n}\n'],
  ['`!=` then a call', '@function has($map, $key) { @return map-has-key($map, $key) and map-get($map, $key) != null; } .a { b: has(("k": 1), "k"); }', '.a {\n  b: true;\n}\n']
];

describe('comparison in a value', () => {
  it.each(cases)('%s', async (_label, source, css) => {
    expect(await new Compiler({ output: { collapseNesting: true } }).renderString(source, { extension: '.scss' })).toBe(css);
  });
});
