import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * A `.scss` `@function` body runs before its `@return` is read: a local it
 * declares, a parameter it reassigns (in an `@if` too) and a loop's accumulator
 * are the values `@return` reads. Every expectation is Dart Sass 1.101.7's output.
 */
const render = async (source: string): Promise<string> =>
  new Compiler().renderString(source, { extension: '.scss' });

const cases: ReadonlyArray<readonly [name: string, source: string, expected: string]> = [
  [
    'a local',
    '@function f() { $q: 1; @return $q; } a { b: f(); }',
    'a {\n  b: 1;\n}\n'
  ],
  [
    'locals that read earlier locals',
    '@function f($x) { $y: $x * 2; $z: $y + 1; @return $z; } a { b: f(3); }',
    'a {\n  b: 7;\n}\n'
  ],
  [
    'a local written three times',
    '@function f() { $a: 1; $a: $a + 1; $a: $a * 3; @return $a; } a { b: f(); }',
    'a {\n  b: 6;\n}\n'
  ],
  [
    'a parameter reassigned in an @if',
    '@function f($v) { @if true { $v: 2; } @return $v; } a { b: f(1); }',
    'a {\n  b: 2;\n}\n'
  ],
  [
    'a parameter reassigned from itself',
    '@function f($v) { $v: $v + 1; @return $v; } a { b: f(1); }',
    'a {\n  b: 2;\n}\n'
  ],
  [
    'a defaulted parameter reassigned in one call and kept in another',
    '@function f($v: 1) { @if $v > 0 { $v: $v * 10; } @return $v; } a { b: f(); c: f(-1); }',
    'a {\n  b: 10;\n  c: -1;\n}\n'
  ],
  [
    'an @if / @else if / @else chain that writes the parameter',
    '@function f($x) { @if $x == 1 { $x: one; } @else if $x == 2 { $x: two; } @else { $x: many; } @return $x; }\n'
    + 'a { b: f(1); c: f(2); d: f(5); }',
    'a {\n  b: one;\n  c: two;\n  d: many;\n}\n'
  ],
  [
    'an @each accumulator',
    '@function sum($list) { $t: 0; @each $n in $list { $t: $t + $n; } @return $t; } a { b: sum(1 2 3); }',
    'a {\n  b: 6;\n}\n'
  ],
  [
    'an @each accumulator that appends',
    '@function f() { $l: (); @each $i in 1 2 3 { $l: append($l, $i * 2); } @return $l; } a { b: f(); }',
    'a {\n  b: 2 4 6;\n}\n'
  ],
  [
    'an @for accumulator, called twice',
    '@function fact($n) { $r: 1; @for $i from 1 through $n { $r: $r * $i; } @return $r; } a { b: fact(4); c: fact(3); }',
    'a {\n  b: 24;\n  c: 6;\n}\n'
  ],
  [
    'a @while counter',
    '@function f() { $i: 0; @while $i < 3 { $i: $i + 1; } @return $i; } a { b: f(); }',
    'a {\n  b: 3;\n}\n'
  ],
  [
    'a local that shadows a global, which keeps its value',
    '$q: 10; @function f() { $q: 1; @return $q; } a { b: f(); c: $q; }',
    'a {\n  b: 1;\n  c: 10;\n}\n'
  ],
  [
    'an accumulator that shadows a global',
    '$t: 100; @function sum($l) { $t: 0; @each $n in $l { $t: $t + $n; } @return $t; } a { b: sum(1 2); c: $t; }',
    'a {\n  b: 3;\n  c: 100;\n}\n'
  ],
  [
    'a function whose local holds another function\'s result',
    '@function inc($x) { $x: $x + 1; @return $x; } @function twice($x) { $y: inc($x); @return inc($y); }\n'
    + 'a { b: twice(1); }',
    'a {\n  b: 3;\n}\n'
  ],
  [
    'a local holding a module function\'s result',
    '@use "sass:math";\n'
    + '@function rem($px, $base: 16px) { $r: math.div($px, $base); @return $r * 1rem; } a { b: rem(24px); }',
    'a {\n  b: 1.5rem;\n}\n'
  ],
  [
    'a function result passed to a mixin',
    '@mixin m($v) { width: $v; } @function g() { $w: 5px; @return $w; } .c { @include m(g()); }',
    '.c {\n  width: 5px;\n}\n'
  ]
];

describe('scss: an @function body runs before @return is read', () => {
  it.each(cases)('%s', async (_name, source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });
});
