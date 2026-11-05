import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/scss-parser';

/** https://sass-lang.com/documentation/at-rules/extend/ */
describe('`@extend` directly in a mixin body', () => {
  it('reads the Foundation 6.9.0 `components/_reveal.scss` spelling, carried on the definition', () => {
    const source = `@mixin reveal-modal-width($width: $reveal-width, $max-width: $reveal-max-width) {
  // Extends must be made outside of breakpoints for compatibility with newer Sass versions (libsass v3.5)
  @extend %reveal-centered;
  @include breakpoint(medium) {
    width: $width;
    max-width: $max-width;
  }
}`;
    expect(parse(source)).toMatchObject({
      rules: [{
        type: 'MixinDefinition',
        extendInstructions: [{ target: { type: 'SelectorList' }, partial: true, optional: false }],
        rules: [{ type: 'MixinCall' }]
      }]
    });
  });

  it('reads `!optional`', () => {
    expect(parse('@mixin m { @extend .b !optional; }')).toMatchObject({
      rules: [{ extendInstructions: [{ optional: true }] }]
    });
  });

  it.each([
    ['@if', '.a { @if true { @extend .b; } }'],
    ['@each', '.a { @each $x in 1 { @extend .b; } }'],
    ['@for', '.a { @for $i from 1 through 2 { @extend .b; } }']
  ])('PINNED DEFECT — rejects it in %s, which has no carrier', (_label, source) => {
    expect(() => parse(source)).toThrow();
  });
});
