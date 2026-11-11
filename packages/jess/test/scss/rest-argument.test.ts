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

const render = (source: string) => new Compiler().renderString(source, { extension: '.scss' });

describe('a keyword after a rest argument stays on its own value', () => {
  it.each([
    ['$l: 1 2; .a { b: rgb($l..., $blue: 3); }', '.a {\n  b: rgb(1, 2, 3);\n}\n'],
    ['$l: "abcd" 2; .a { b: str-slice($l..., $end-at: 3); }', '.a {\n  b: "bc";\n}\n'],
    ['$l: 2 3; .a { b: rgb(1, $l..., $alpha: 0.5); }', '.a {\n  b: rgba(1, 2, 3, 0.5);\n}\n'],
    ['$l: red; .a { b: lighten($amount: 10%, $l...); }', '.a {\n  b: #ff3333;\n}\n'],

    /* Sass writes this colour as `rgb(30%, 0%, 70%)`. */
    ['$l: red blue; .a { b: mix($l..., $weight: 30%); }', '.a {\n  b: #4d00b3;\n}\n'],

    /* As `hsl(50%, 50%, $hue: 1)`: positional arguments fill the slots the keywords leave. */
    ['$l: 50% 50%; .a { b: hsl($l..., $hue: 1); }', '.a {\n  b: hsl(1, 50%, 50%);\n}\n']
  ])('%s', async (source, css) => {
    expect(await render(source)).toBe(css);
  });

  it('writes a call it cannot bind with each argument once', async () => {
    expect(await render('$l: red 20%; .a { b: lighten($amount: 10%, $l...); }')).toBe('.a {\n  b: lighten($amount: 10%, red, 20%);\n}\n');
  });
});

describe('a rest argument with no items to pass', () => {
  it.each([
    ['$m: (color: red, amount: 10%);\n.a {\n  b: lighten($m...);\n}', 'eval/invalid-function', 3, 16],
    ['$m: (amount: 10%);\n.a {\n  b: lighten(red, $m...);\n}', 'eval/invalid-function', 3, 21],
    ['.a {\n  b: hsl(from red h s l...);\n}', 'eval/invalid-function', 2, 24],
    ['$c: h s l;\n.a {\n  b: hsl(from red $c...);\n}', 'eval/invalid-function', 3, 21],
    ['$e: ();\n.a {\n  b: max($e...);\n}', 'eval/empty-list-value', 3, 12],
    ['$e: ();\n.a {\n  b: rgb($e...);\n}', 'eval/empty-list-value', 3, 12],
    ['$e: ();\n.a {\n  b: foo($e...);\n}', 'eval/empty-list-value', 3, 12]
  ])('%s', async (source, code, line, column) => {
    await expect(render(source)).rejects.toMatchObject({ code, line, column });
  });

  it('passes none to a function of the stylesheet', async () => {
    expect(await render('@function f($a: 1) { @return $a; } $e: (); .a { b: f($e...); }')).toBe('.a {\n  b: 1;\n}\n');
  });
});
