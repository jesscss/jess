import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/scss-parser';

/** https://sass-lang.com/documentation/at-rules/css/#media */
describe('a `#{…}` as a media term', () => {
  it.each([
    ['Foundation `util/_breakpoint.scss`', '@media print, screen and #{$str} { a { b: c; } }'],
    ['the whole query', '@media #{$str} { a { b: c; } }'],
    ['after `not`', '@media not #{$str} { a { b: c; } }'],
    ['on both sides of `and`', '@media #{$a} and #{$b} { a { b: c; } }'],
    ['before a feature', '@media #{$a} and (min-width: 1px) { a { b: c; } }'],
    ['nested', 'a { @media #{$str} { b: c; } }']
  ])('reads %s', (_label, source) => {
    expect(() => parse(source)).not.toThrow();
  });

  it('keeps a plain media query plain', () => {
    expect(parse('@media screen and (min-width: 1px) { a { b: c; } }')).toMatchObject({
      rules: [{ type: 'AtRuleBlock', prelude: { type: 'Sequence' } }]
    });
  });
});
