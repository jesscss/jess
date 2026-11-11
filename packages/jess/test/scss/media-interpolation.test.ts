import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * Each expectation is what `sass --no-source-map` 1.101.7 writes for the source
 * (https://sass-lang.com/documentation/at-rules/css/#media). The first spelling is
 * Foundation 6.9.0's `util/_breakpoint.scss`.
 */
const cases: ReadonlyArray<readonly [string, string]> = [
  ['$s: "(min-width: 1px)"; @media print, screen and #{$s} { .a { b: c; } }', '@media print, screen and (min-width: 1px) {\n  .a {\n    b: c;\n  }\n}\n'],
  ['$s: "(min-width: 1px)"; @media #{$s} { .a { b: c; } }', '@media (min-width: 1px) {\n  .a {\n    b: c;\n  }\n}\n'],
  ['$s: "(min-width: 1px)"; @media not #{$s} { .a { b: c; } }', '@media not (min-width: 1px) {\n  .a {\n    b: c;\n  }\n}\n'],
  ['$a: "(min-width: 1px)"; $b: "(max-width: 2px)"; @media #{$a} and #{$b} { .a { b: c; } }', '@media (min-width: 1px) and (max-width: 2px) {\n  .a {\n    b: c;\n  }\n}\n'],
  ['$s: "scr"; @media #{$s}een { .a { b: c; } }', '@media screen {\n  .a {\n    b: c;\n  }\n}\n'],
  ['$s: "screen"; @media #{$s} and (min-width: 1px) { .a { b: c; } }', '@media screen and (min-width: 1px) {\n  .a {\n    b: c;\n  }\n}\n']
];

describe('a `#{…}` as a media term', () => {
  it.each(cases)('%s', async (source, css) => {
    expect(await new Compiler().renderString(source, { extension: '.scss' })).toBe(css);
  });

  /* Each expectation is what `sass` 1.101.7 writes. */
  it.each([
    ['an identifier before it', '$s: een; @media scr#{$s} { .a { b: c; } }', 'screen'],
    ['an identifier after it', '$s: scr; @media #{$s}een { .a { b: c; } }', 'screen'],
    ['another hole', '$s: scr; $t: een; @media #{$s}#{$t} { .a { b: c; } }', 'screen'],
    ['both sides, before `and`', '$s: x; @media a#{$s}b and (color) { .a { b: c; } }', 'axb and (color)'],
    ['after `not`', '$s: x; @media not scr#{$s} { .a { b: c; } }', 'not scrx'],
    ['in a list', '$s: x; @media scr#{$s}, print { .a { b: c; } }', 'scrx, print']
  ])('glues %s into one term', async (_label, source, query) => {
    const css = await new Compiler().renderString(source, { extension: '.scss' });
    expect(css).toBe(`@media ${query} {\n  .a {\n    b: c;\n  }\n}\n`);
  });

  it('keeps two terms a space apart', async () => {
    const css = await new Compiler().renderString('$s: scr; $t: een; @media #{$s} #{$t} { .a { b: c; } }', { extension: '.scss' });
    expect(css).toBe('@media scr een {\n  .a {\n    b: c;\n  }\n}\n');
  });
});
