import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/scss-parser';

/** Bootstrap 5.3.8 `helpers/_color-bg.scss`, `helpers/_colored-links.scss` and `mixins/_utilities.scss`. */
describe('`!important` as a call argument', () => {
  it.each([
    ['.a { color: color-contrast($value) if($enable-important-utilities, !important, null); }'],
    ['.a { #{$property}: $value if($enable-important-utilities, !important, null); }'],
    ['.a { color: red if($e, ! important, null); }'],
    ['.a { color: red if($e, !IMPORTANT, null); }']
  ])('reads %s', (source) => {
    expect(() => parse(source)).not.toThrow();
  });

  it('is a value of the call, and leaves the declaration its own marker', () => {
    expect(parse('.a { x: f(!important); y: z !important; }')).toMatchObject({
      rules: [{ rules: [
        { name: 'x', important: false, value: { type: 'FunctionCall', args: [{ value: { type: 'Any', src: '!important' } }] } },
        { name: 'y', important: true }
      ] }]
    });
  });

  /* Pinned so a change shows, not as a requirement: it is balanced, so it belongs to jess#592. */
  it('PINNED DEFECT: rejects any other `!` word', () => {
    expect(() => parse('.a { x: f(!foo); }')).toThrow();
  });
});
