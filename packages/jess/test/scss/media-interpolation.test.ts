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

  /* PINNED DEFECT: `sass` 1.101.7 writes `@media screen`. An identifier and a hole glued together read as two terms. */
  it('PINNED DEFECT — splits a hole glued after an identifier', async () => {
    const css = await new Compiler().renderString('$s: "een"; @media scr#{$s} { .a { b: c; } }', { extension: '.scss' });
    expect(css).toBe('@media scr een {\n  .a {\n    b: c;\n  }\n}\n');
  });
});
