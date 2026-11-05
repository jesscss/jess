import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/scss-parser';

/**
 * A `#{…}` stands anywhere in a pseudo selector: its name, and its argument,
 * An+B included. The shapes are Bootstrap's (`_tables.scss`,
 * `helpers/_stretched-link.scss`, `mixins/_forms.scss`, `mixins/_utilities.scss`)
 * and Foundation's (`components/_button-group.scss`, `grid/_layout.scss`,
 * `util/_mixins.scss`, `prototype/_relation.scss`).
 */
describe('SCSS pseudo selector interpolation', () => {
  it.each([
    ['the whole An+B', '.t { > tbody > tr:nth-of-type(#{$table-striped-order}) > * { a: b; } }'],
    ['an An+B step', '.g { &:nth-of-type(#{$n}n+1) { a: b; } }'],
    ['an An+B offset, spaced', '.g { &:nth-child(-n + #{$num}) { a: b; } }'],
    ['an An+B offset, glued', 'a:nth-last-child(2n+#{$x}) { b: c; }'],
    ['a generic argument', 'a:foo(#{$x}) { b: c; }'],
    ['a hole in an argument group', 'a:foo(x (y #{$x}) z) { b: c; }'],
    ['a pseudo-element name', '.a { &::#{$stretched-link-pseudo-element} { b: c; } }'],
    ['a pseudo-class name after a hole', '.was-validated #{if(&, "&", "")}:#{$state}, #{if(&, "&", "")}.is-#{$state} { a: b; }'],
    ['a pseudo-class name after an interpolated class', '.#{$property-class + $infix + $property-class-modifier}-#{$pseudo}:#{$pseudo} { a: b; }']
  ])('reads %s', (_label, source) => {
    expect(() => parse(source)).not.toThrow();
  });

  it('keeps a hole in an argument typed, inside one interpolated selector', () => {
    expect(parse('a:foo(x #{$y}) { b: c; }')).toMatchObject({
      rules: [{ selector: { selectors: [{ value: [
        { text: 'a' },
        { text: null, interp: { parts: [{ lit: ':foo(x ' }, { ref: { type: 'Lookup', name: 'y' }, unquote: true }, { lit: ')' }] } }
      ] }] } }]
    });
  });

  it('still rejects a malformed An+B', () => {
    for (const source of ['a:nth-child(2n+) { b: c; }', 'a:nth-child(2n + x) { b: c; }', 'a:nth-child(1.5) { b: c; }']) {
      expect(() => parse(source)).toThrow();
    }
  });

  it('keeps the bytes of a static argument, whitespace after a group included', () => {
    expect(JSON.stringify(parse('a:foo(x (y) z) { b: c; }'))).toContain(':foo(x (y) z)');
  });
});
