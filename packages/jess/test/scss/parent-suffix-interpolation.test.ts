import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseScss } from '@jesscss/scss-parser';
import { Compiler } from '../../src/index.js';

/**
 * A `&` with a name glued after it builds that name on its parent (Sass "Adding
 * Suffixes"; ledger J13), and an interpolated suffix is a suffix like any other:
 * `$x: y; .a { &-#{$x} {} }` is `.a-y`. `.scss` reads the `&` and its suffix as one
 * token, as Less and `.jess` do, so every form takes one path and converting the
 * document writes the same CSS.
 */
type Mode = false | 'native' | 'compact';

const render = async (source: string, language: 'scss' | 'jess', collapseNesting: Mode = false) => {
  const result = await new Compiler({ quiet: true, output: { collapseNesting } }).renderToResult(
    { source, filePath: `/proj/entry.${language}` },
    { quiet: true, suppressWarnings: true, breakOnError: false }
  );
  expect(result.errors).toEqual([]);
  return String(result.css);
};

const rule = (selector: string) => `${selector} {\n  c: d;\n}\n`;

describe('.scss: an interpolated suffix writes what the same suffix written out writes', () => {
  const documents: ReadonlyArray<(suffix: string) => string> = [
    suffix => `.a { &${suffix} { c: d; } }`,
    suffix => `.a, .e { &${suffix} { c: d; } }`,
    suffix => `.n .m { &${suffix} { c: d; } }`,
    suffix => `.a::before { &${suffix} { c: d; } }`,
    suffix => `a:hover { &${suffix} { c: d; } }`,
    suffix => `.a { &${suffix}.g { c: d; } }`,
    suffix => `.a { &${suffix} &${suffix} { c: d; } }`,
    suffix => `.a { .g &${suffix} { c: d; } }`,
    suffix => `.a, .e { &${suffix} { &:hover { c: d; } } }`,
    suffix => `.n { &${suffix} { .k { e: f; } } }`,
    suffix => `.n { &${suffix} { @media (a) { .k { e: f; } } } }`,
    suffix => `.a { &${suffix} { &__z { c: d; } } }`,
    suffix => `.a { e: f; &${suffix} { c: d; } g: h; }`,
    suffix => `.a { :not(&${suffix}) { c: d; } }`,
    suffix => `.q { c: d; }\n.a, .e { &${suffix} { @extend .q; } }`
  ];

  describe.each<Mode>([false, 'native', 'compact'])('collapseNesting %s', (mode) => {
    it.each([
      ['-', '-#{$x}', '-y'],
      ['__', '__#{$x}', '__y'],
      ['--', '--#{$x}', '--y'],
      ['nothing', '#{$x}', 'y'],
      ['-b', '-b#{$x}', '-by'],
      ['__b', '__b#{$x}', '__by'],
      ['--b', '--b#{$x}', '--by'],
      ['b', 'b#{$x}', 'by'],
      ['1', '1#{$x}', '1y'],
      ['é', 'é#{$x}', 'éy'],
      ['- and a tail', '-#{$x}-z', '-y-z']
    ])('before the interpolation: %s', async (_name, interpolated, written) => {
      for (const document of documents) {
        const expected = await render(document(written), 'scss', mode);
        const scss = `$x: y;\n${document(interpolated)}`;
        expect(await render(scss, 'scss', mode), scss).toBe(expected);
        expect(await render(emitJess(parseScss(scss)), 'jess', mode), scss).toBe(expected);
      }
    });
  });

  it('an extend names the built selector', async () => {
    const scss = '$x: y;\n.a, .e { &--#{$x} { c: d; } }\n.z { @extend .e--y; }';
    expect(await render(scss, 'scss')).toBe(rule('.a--y,\n.e--y,\n.z'));
  });

  /* Undecided (jesscss/jess#624): this pins that converting agrees and today's order, not what a comma in a splice means. */
  it('a list spliced after the suffix multiplies the same way converted', async () => {
    const scss = '$l: q, r;\n.a, .e { &-#{$l} { c: d; } }';
    expect(await render(scss, 'scss')).toBe(rule('.a-q,\n.e-q,\n.a-r,\n.e-r'));
    expect(await render(emitJess(parseScss(scss)), 'jess')).toBe(rule('.a-q,\n.e-q,\n.a-r,\n.e-r'));
  });

  it.each([
    ['.a { &#{null} { c: d; } }', rule('.a')],
    ['.a { &-#{null} { c: d; } }', rule('.a-')],
    ['.a { &#{".b"} { c: d; } }', rule('.a.b')],
    ['.a { &#{" .b"} { c: d; } }', rule('.a .b')]
  ])('a value that is not a name: %s', async (source, css) => {
    expect(await render(source, 'scss')).toBe(css);
  });
});

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

  it('an escape glued to `&` converts to the same CSS', async () => {
    const scss = '.a { &\\62 { c: d; } }';
    expect(await render(emitJess(parseScss(scss)), 'jess')).toBe(await render(scss, 'scss'));
  });

  it.each([
    ['.a { &.#{$x} { c: d; } }', '.a {\n  &.y {\n    c: d;\n  }\n}\n'],
    ['.a { &##{$x} { c: d; } }', '.a {\n  &#y {\n    c: d;\n  }\n}\n'],
    ['.a { & #{$x} { c: d; } }', '.a {\n  & y {\n    c: d;\n  }\n}\n']
  ])('a `&` that builds no name stays a reference: %s', async (source, css) => {
    expect(await render(`$x: y;\n${source}`, 'scss')).toBe(css);
  });
});
