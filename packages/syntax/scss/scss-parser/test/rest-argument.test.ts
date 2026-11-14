import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/scss-parser';

/** https://sass-lang.com/documentation/at-rules/function/#taking-arbitrary-arguments */
describe('a rest argument to a function', () => {
  it('reads the Bootstrap 5.3.8 `_functions.scss` spelling', () => {
    const source = '@function map-loop($map, $func, $args...) { $_map: map-merge($_map, ($key: call(get-function($func), $_args...))); @return $_map; }';
    expect(() => parse(source)).not.toThrow();
  });

  it('marks only the last argument as spread', () => {
    expect(parse('.a { x: f(1, $a...); }')).toMatchObject({
      rules: [{ rules: [{ value: { type: 'FunctionCall', args: [
        { spread: false },
        { value: { type: 'Lookup', name: 'a' }, spread: true }
      ] } }] }]
    });
  });

  it('reads a list written in place', () => {
    expect(() => parse('.a { x: f((1, 2)...); }')).not.toThrow();
  });
});
