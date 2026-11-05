import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

const compile = (source: string) => new Compiler({ output: { collapseNesting: true } }).renderString(source, { extension: '.scss' });

/**
 * A function yields a `@return` written directly in its body or in an `@if`/`@else`
 * branch of it. Any other `@return` parses and fails the compile where it is
 * reached; it never becomes a `result` property in the CSS.
 */
describe('a @return no function reads', () => {
  it.each([
    ['in a rule', '.a {\n  @return 1;\n}', 2, 3],
    ['in @media in a rule', '@media print {\n  .a {\n    @return 1;\n  }\n}', 3, 5],
    ['in an included mixin', '@mixin m {\n  @return 1;\n}\n.a {\n  @include m;\n}', 2, 3],
    ['in a root @each', '@each $i in 1 2 {\n  @return $i;\n}', 2, 3],
    ['in an @each in a function', '@function f($l) {\n  @each $i in $l {\n    @return $i;\n  }\n  @return 0;\n}\n.a {\n  b: f(1 2);\n}', 3, 5],
    ['in an @each in a function that returns nothing else', '@function f() {\n  @each $i in 1 2 {\n    @return $i;\n  }\n}\n.a {\n  b: f();\n}', 3, 5],
    ['in a @for in a function', '@function f() {\n  @for $i from 1 through 2 {\n    @return $i;\n  }\n}\n.a {\n  b: f();\n}', 3, 5],
    ['in a @while in a function', '@function f($n) {\n  @while $n > 0 {\n    @return $n;\n  }\n  @return 0;\n}\n.a {\n  b: f(1);\n}', 3, 5],
    ['in an @each in an @if in a function', '@function f($l) {\n  @if $l {\n    @each $i in $l {\n      @return $i;\n    }\n  }\n  @return 0;\n}\n.a {\n  b: f(1);\n}', 4, 7]
  ])('%s', async (_label, source, line, column) => {
    await expect(compile(source)).rejects.toMatchObject({ code: 'parse/return-placement', line, column });
  });

  it.each([
    ['directly in a function', '@function f() { @return 1; } .a { b: f(); }', '.a {\n  b: 1;\n}\n'],
    ['in an @if, then a later @return', '@function f() { @if true { @return 1; } @return 2; } .a { b: f(); }', '.a {\n  b: 2;\n}\n'],
    ['of a space list', '@function f() { @return 1 1 0; } .a { b: f(); }', '.a {\n  b: 1 1 0;\n}\n'],
    ['a loop that assigns, then a @return', '@function f($a) { @each $i in 1 2 { $a: $i; } @return $a; } .a { b: f(0); }', '.a {\n  b: 2;\n}\n']
  ])('keeps a @return %s', async (_label, source, css) => {
    expect(await compile(source)).toBe(css);
  });
});

describe('!global with no global to assign', () => {
  it.each([
    ['in a rule', '.a {\n  $g: 1 !global;\n}'],
    ['in @media', '@media screen {\n  $g: 1 !global;\n}']
  ])('%s', async (_label, source) => {
    await expect(compile(source)).rejects.toMatchObject({ code: 'resolve/name-not-found' });
  });
});

it('reports a directive with a space list', async () => {
  await expect(compile('@error 1 1 0;')).rejects.toMatchObject({ code: 'eval/scss-error', message: expect.stringContaining('1 1 0') });
});
