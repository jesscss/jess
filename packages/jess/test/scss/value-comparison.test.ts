import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * A comparison in a value has the precedence Sass gives it, and `==` means what it
 * means in `@if` (a relational does not yet: jess#591): https://sass-lang.com/documentation/operators/#order-of-operations.
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

const compile = (source: string) => new Compiler({ output: { collapseNesting: true } }).renderString(source, { extension: '.scss' });

describe('a comparison with an if() operand', () => {
  it.each([
    ['on the left', '$a: true; $x: if($a, b, c) == d; .a { y: $x; }', '.a {\n  y: false;\n}\n'],
    ['on the right', '$a: true; .a { y: b == if($a, b, c); }', '.a {\n  y: true;\n}\n'],
    ['in the CSS form', 'a { b: if(sass(false): c) == null; }', 'a {\n  b: true;\n}\n']
  ])('%s', async (_label, source, css) => {
    expect(await compile(source)).toBe(css);
  });
});

/* `sass` rejects these too; none may come out as a boolean. */
describe('ordering what has no order', () => {
  it.each([
    ['two keywords', 'a {\n  x: a < b;\n}', 2],
    ['two strings', 'a {\n  x: "a" < "b";\n}', 2],
    ['units that do not convert', 'a {\n  x: 1px < 1em;\n}', 2],
    ['a nested property block whose value reads as a comparison', '.a {\n  b: hover > c { d: e; }\n}', 2],
    ['a slash before a comparison, glued', 'a {\n  x: 1/2 == 0.5;\n}', 2],
    ['a slash before a comparison, spaced', 'a {\n  x: 1 / 2 == 0.5;\n}', 2],
    ['a slash after a comparison', 'a {\n  x: a == 1/2;\n}', 2],
    ['a slash under `and`', 'a {\n  x: 1/2 == 0.5 and b;\n}', 2],
    ['a slash in `if()`', '$a: 4;\nb {\n  c: if($a/2 > 1, x, y);\n}', 3],
    ['a slash before a comparison in `@if`, glued', '$a: 4;\n@if $a/2 == 2 {\n  b { c: d; }\n}', 2],
    ['a slash before a comparison in `@if`, spaced', '$a: 4;\n@if $a / 2 == 2 {\n  b { c: d; }\n}', 2],
    ['a slash after a comparison in `@if`', '$a: 4;\n@if 2 == $a/2 {\n  b { c: d; }\n}', 2],
    ['a slash before a comparison in `@while`', '$a: 4;\n@while $a/2 > 9 {\n  b { c: d; }\n}', 2]
  ])('%s', async (_label, source, line) => {
    await expect(compile(source)).rejects.toMatchObject({ code: 'eval/incomparable-operands', line });
  });

  it('reads the division a group holds in `@if`', async () => {
    expect(await compile('$a: 4;\n@if ($a/2) == 2 {\n  b { c: d; }\n}')).toBe('b {\n  c: d;\n}\n');
  });

  it('orders numbers on units that convert, and a unitless number with any', async () => {
    expect(await compile('a { x: 1cm > 1mm; y: 1 < 2px; z: (1/2) == 0.5; }')).toBe('a {\n  x: true;\n  y: true;\n  z: true;\n}\n');
  });
});

describe('a CSS data type in a call', () => {
  it.each([
    ['attr(x <length>)'],
    ['attr(x <length>, 0)'],
    ['attr(x type(<length>))'],
    ['attr(x y <length>)']
  ])('%s keeps its bytes', async (value) => {
    expect(await compile(`a { b: ${value}; }`)).toBe(`a {\n  b: ${value};\n}\n`);
  });
});
