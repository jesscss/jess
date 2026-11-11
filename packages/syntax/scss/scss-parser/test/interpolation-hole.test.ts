import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/scss-parser';

/**
 * `#{…}` holds a whole SassScript value, padded or not, in every position: the
 * shapes are Bootstrap's (`scss/_offcanvas.scss`, `scss/_close.scss`). The Sass
 * reference, https://sass-lang.com/documentation/interpolation/, reads the hole as
 * a SassScript expression, so a space list is one value there as it is anywhere.
 */
describe('SCSS interpolation hole', () => {
  it.each([
    ['a space list in a custom-property value', '.offcanvas { --#{$prefix}offcanvas-transition: #{transform $offcanvas-transition-duration ease-in-out}; }'],
    ['a space list in a declaration', '.a { transition: #{transform $duration ease-in-out}; }'],
    ['a space list in a variable', '$transition: #{transform $duration ease-in-out};'],
    ['a padded hole in a custom-property value', '.btn-close { --#{$prefix}btn-close-bg: #{ escape-svg($btn-close-bg) }; }'],
    ['a padded hole inside a function in a custom-property value', '.a { --x: f(#{ $y }); }']
  ])('reads %s', (_label, source) => {
    expect(() => parse(source)).not.toThrow();
  });

  it('keeps a space list one interpolation part', () => {
    expect(parse('.a { x: #{a b}; }')).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [{
        type: 'Declaration',
        value: { type: 'Interpolation', parts: [{ ref: { type: 'Sequence', parts: [{ type: 'Keyword' }, { type: 'Keyword' }] }, unquote: true }] }
      }] }]
    });
  });
});
