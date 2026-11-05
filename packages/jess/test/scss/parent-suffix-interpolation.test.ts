import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseScss } from '@jesscss/scss-parser';
import { Compiler } from '../../src/index.js';

/**
 * A `&` with a name glued after it builds that name on its parent (Sass "Adding
 * Suffixes"; ledger J13), and an interpolated suffix is a suffix like any other:
 * `$x: y; .a { &-#{$x} {} }` is `.a-y`. `.scss` reads `&-#{$x}` as `&` then an
 * interpolated token, and `.jess` reads its spelling as one token, so converting
 * the document writes the same CSS.
 */
const render = async (source: string, language: 'scss' | 'jess') => {
  const result = await new Compiler({ quiet: true }).renderToResult(
    { source, filePath: `/proj/entry.${language}` },
    { quiet: true, suppressWarnings: true, breakOnError: false }
  );
  expect(result.errors).toEqual([]);
  return String(result.css);
};

const rule = (selector: string) => `${selector} {\n  c: d;\n}\n`;

describe('.scss: an interpolated parent suffix', () => {
  it.each([
    ['.a { &-#{$x} { c: d; } }', rule('.a-y')],
    ['.a { &__#{$x} { c: d; } }', rule('.a__y')],
    ['.a { &#{$x} { c: d; } }', rule('.ay')],
    ['.a { &--#{$x} { c: d; } }', rule('.a--y')],
    ['.a { &-b#{$x} { c: d; } }', rule('.a-by')],
    ['.a { &__b#{$x} { c: d; } }', rule('.a__by')],
    ['.a { &--b#{$x} { c: d; } }', rule('.a--by')],
    ['.a { &-#{$x}-z { c: d; } }', rule('.a-y-z')],
    ['.a { &-#{$x}.e { c: d; } }', rule('.a-y.e')],
    ['.a { &#{$x}:hover { c: d; } }', rule('.ay:hover')],
    ['.a { &-#{$x} .e { c: d; } }', rule('.a-y .e')],
    ['.a { .e &-#{$x} { c: d; } }', rule('.e .a-y')],
    ['.a { &-#{$x} &__#{$x} { c: d; } }', rule('.a-y .a__y')],
    ['.a { &#{$x} &#{$x} { c: d; } }', rule('.ay .ay')],
    ['.a { &-#{$x} + &--#{$x} { c: d; } }', rule('.a-y + .a--y')],
    ['.a { &-#{$x}, &__#{$x} { c: d; } }', rule('.a-y,\n.a__y')],
    ['.a, .e { &-#{$x} { c: d; } }', rule('.a-y,\n.e-y')],
    ['.a, .e { &#{$x} { c: d; } }', rule('.ay,\n.ey')],
    ['.a, .e { &--#{$x} { c: d; } }', rule('.a--y,\n.e--y')],
    ['.a .f { &-#{$x} { c: d; } }', rule('.a .f-y')],
    ['.a { &-#{$x} { &__#{$x} { c: d; } } }', rule('.a-y__y')],
    ['.a { &-#{$x} { e: f; &:hover { c: d; } } }', `.a-y {\n  e: f;\n}\n${rule('.a-y:hover')}`],
    ['.a { e: f; &-#{$x} { c: d; } }', `.a {\n  e: f;\n}\n${rule('.a-y')}`],
    ['.a { @media (min-width: 1px) { &-#{$x} { c: d; } } }', '@media (min-width: 1px) {\n  .a-y {\n    c: d;\n  }\n}\n'],
    ['.a { @each $i in p, q { &-#{$i} { c: d; } } }', `${rule('.a-p')}${rule('.a-q')}`],
    ['.a { @for $i from 1 through 2 { &-#{$i} { c: d; } } }', `${rule('.a-1')}${rule('.a-2')}`],
    ['@mixin m($n) { &-#{$n} { c: d; } }\n.a { @include m(q); }', rule('.a-q')],
    ['.d { c: d; }\n.a { &-#{$x} { @extend .d; } }', rule('.d,\n.a-y')],
    ['.a { &-#{$x} { c: d; } }\n.e { @extend .a-y; }', rule('.a-y,\n.e')]
  ])('%s', async (source, css) => {
    const scss = `$x: y;\n${source}`;
    expect(await render(scss, 'scss')).toBe(css);
    expect(await render(emitJess(parseScss(scss)), 'jess')).toBe(css);
  });

  it.each([
    ['.a { &.#{$x} { c: d; } }', '.a {\n  &.y {\n    c: d;\n  }\n}\n'],
    ['.a { &##{$x} { c: d; } }', '.a {\n  &#y {\n    c: d;\n  }\n}\n'],
    ['.a { & #{$x} { c: d; } }', '.a {\n  & y {\n    c: d;\n  }\n}\n']
  ])('a `&` that builds no name stays a reference: %s', async (source, css) => {
    expect(await render(`$x: y;\n${source}`, 'scss')).toBe(css);
  });
});
