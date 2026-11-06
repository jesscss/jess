import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/scss-parser';
import { serialize } from '../../../../core/src/ast/serialize.js';

/** A `//` is a comment wherever whitespace may stand in SassScript: https://sass-lang.com/documentation/syntax/comments/ */
describe('a line comment in a value', () => {
  it.each([
    ['Bootstrap `_utilities.scss`', `$utilities: map-merge(
  (
    // scss-docs-start utils-vertical-align
    "align": (
      property: vertical-align,
      class: align,
      values: baseline top middle bottom text-bottom text-top
    ),
    // scss-docs-end utils-vertical-align
  ),
  $utilities
);`],
    ['after the last map item', '$m: (\n  "a": b,\n  // d\n);'],
    ['after an argument', '.a { x: f(a, // d\n  b); }'],
    ['before a comma', '.a { x: f(a // d\n  , b); }'],
    ['in a math group', '.a { x: (1 + // c\n  2); }'],
    ['after a math operator', '.a { x: 1 + // c\n  2; }'],
    ['in a space list', '.a { x: a // c\n  b; }'],
    ['in a comma list', '.a { x: a, // c\n  b; }']
  ])('reads one %s', (_label, source) => {
    expect(() => parse(source)).not.toThrow();
  });

  it('writes none of them', () => {
    expect(serialize(parse('.a { x: foo( // lead\n a // mid\n , b // tail\n); }')).css).not.toContain('//');
  });

  it('is not a comment in a url() or a custom property', () => {
    expect(serialize(parse('.a { x: url(//e.com/a); --y: //z; }')).css).toBe('.a {\n  x: url(//e.com/a);\n  --y: //z;\n}\n');
  });
});
