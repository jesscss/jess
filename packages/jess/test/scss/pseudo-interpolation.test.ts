import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * `#{…}` may stand in any selector: https://sass-lang.com/documentation/interpolation/.
 * Every expectation with `collapseNesting` is what `sass --no-source-map` 1.101.7
 * writes for the source; sources follow the Bootstrap 5.3.8 and Foundation 6.9.0
 * files named in the parser's test of the same name.
 */
const cases: ReadonlyArray<readonly [string, string, string]> = [
  ['the whole An+B', '$x: 2; a:nth-child(#{$x}) { b: c; }', 'a:nth-child(2) {\n  b: c;\n}\n'],
  ['a keyword An+B', '$x: odd; a:nth-of-type(#{$x}) { b: c; }', 'a:nth-of-type(odd) {\n  b: c;\n}\n'],
  ['a string An+B', '$x: "2n+1"; a:nth-child(#{$x}) { b: c; }', 'a:nth-child(2n+1) {\n  b: c;\n}\n'],
  ['arithmetic in An+B', '$x: 2; a:nth-child(#{$x + 1}) { b: c; }', 'a:nth-child(3) {\n  b: c;\n}\n'],
  ['an An+B step', '$x: 2; a:nth-of-type(#{$x}n+1) { b: c; }', 'a:nth-of-type(2n+1) {\n  b: c;\n}\n'],
  ['a spaced An+B offset writes unspaced', '$x: 2; a:nth-child(-n + #{$x}) { b: c; }', 'a:nth-child(-n+2) {\n  b: c;\n}\n'],
  ['a spaced An+B step writes unspaced', '$x: 2; .a:nth-child(#{$x}n + 1):before { b: c; }', '.a:nth-child(2n+1):before {\n  b: c;\n}\n'],
  ['padding around a hole', '$x: 2; a:nth-child( #{$x} ) { b: c; }', 'a:nth-child(2) {\n  b: c;\n}\n'],
  ['an `of S` tail', '$x: 2; a:nth-child(2n + #{$x} of .a) { b: c; }', 'a:nth-child(2n+2 of .a) {\n  b: c;\n}\n'],
  ['a generic argument', '$x: b; a:foo(#{$x}) { b: c; }', 'a:foo(b) {\n  b: c;\n}\n'],
  ['a hole in an argument group', '$x: b; a:foo(x (y #{$x}) z) { b: c; }', 'a:foo(x (y b) z) {\n  b: c;\n}\n'],
  ['a pseudo-class name', '$p: hover; .a:#{$p} { b: c; }', '.a:hover {\n  b: c;\n}\n'],
  ['a pseudo-class name that opens a selector', '$p: hover; :#{$p} { b: c; }', ':hover {\n  b: c;\n}\n'],
  ['a pseudo-class name with a tail', '$p: first; a:#{$p}-child { b: c; }', 'a:first-child {\n  b: c;\n}\n'],
  ['a pseudo-element name on the parent', '$p: after; .a { &::#{$p} { b: c; } }', '.a::after {\n  b: c;\n}\n'],
  ['a class and a pseudo-class from one variable', '$p: hover; .x-#{$p}:#{$p} { b: c; }', '.x-hover:hover {\n  b: c;\n}\n']
];

describe('interpolation in a pseudo selector', () => {
  it.each(cases)('%s', async (_label, source, css) => {
    expect(await new Compiler({ output: { collapseNesting: true } }).renderString(source, { extension: '.scss' })).toBe(css);
  });

  it('nests an `&` a hole writes, as Bootstrap writes it in `mixins/_forms.scss`', async () => {
    const source = '.a { .was-validated #{"&"}:valid, #{"&"}.is-valid { b: c; } }';
    expect(await new Compiler().renderString(source, { extension: '.scss' })).toBe('.a {\n  .was-validated &:valid,\n  &.is-valid {\n    b: c;\n  }\n}\n');
  });

  /*
   * PINNED DEFECT: an `&` that comes out of a hole stays text, so it reads as the
   * parent only where the browser nests it. `sass` 1.101.7 writes
   * `.was-validated .a:valid, .a.is-valid { b: c; }`.
   */
  it('PINNED DEFECT: collapsing does not read an `&` a hole writes', async () => {
    const source = '.a { .was-validated #{"&"}:valid, #{"&"}.is-valid { b: c; } }';
    expect(await new Compiler({ output: { collapseNesting: true } }).renderString(source, { extension: '.scss' })).toBe('.a .was-validated &:valid,\n.a &.is-valid {\n  b: c;\n}\n');
  });
});
