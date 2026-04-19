import {
  color,
  hsv
} from '../less/index.js';

import { Color, ColorFormat, Context, Quoted, Dimension } from '@jesscss/core';
import { beforeAll, describe, it, expect } from 'vitest';

let context: Context;

describe('color', () => {
  beforeAll(() => {
    context = new Context();
  });

  it('returns color when given a color', () => {
    const inputColor = new Color('#ff0000');
    expect(color(inputColor)).toBe(inputColor);
  });

  it('normalizes parsed color keyword nodes to hex output', () => {
    const inputColor = new Color({
      format: ColorFormat.HEX,
      node: 'plum',
      rgb: [221, 160, 221],
      alpha: 1
    });

    const result = color(inputColor);

    expect(result).toBeInstanceOf(Color);
    expect(result).not.toBe(inputColor);
    expect(result.value.node).toBeUndefined();
    expect(String(result)).toBe('#dda0dd');
  });

  it('creates color from hex string', () => {
    const result = color(new Quoted('#ff0000'));
    expect(result).toBeInstanceOf(Color);
    expect(String(result)).toBe('#ff0000');
  });

  it('creates color from color keyword', () => {
    const result = color(new Quoted('red'));
    expect(result).toBeInstanceOf(Color);
    expect(String(result)).toBe('#ff0000');
  });

  it('works with object parameters', () => {
    const result = color({ c: new Quoted('#00ff00') });
    expect(result).toBeInstanceOf(Color);
    expect(String(result)).toBe('#00ff00');
  });

  it('serializes hsv() results using Less-compatible hex output', () => {
    const result = hsv(
      new Dimension({ number: 5, unit: '' }),
      new Dimension({ number: 50, unit: '%' }),
      new Dimension({ number: 30, unit: '%' })
    );

    expect(result).toBeInstanceOf(Color);
    expect(String(result)).toBe('#4d2926');
  });

  it('rejects invalid hex color', () => {
    expect(() => color(new Quoted('#invalid'))).toThrow('argument must be a color keyword or 3|4|6|8 digit hex e.g. #FFF');
  });

  it('rejects non-string value', () => {
    expect(() => color(new Dimension({ number: 100, unit: 'px' }))).toThrow('Argument \'c\' must be one of: Color, Quoted');
  });

  it('rejects missing argument', () => {
    expect(() => color.call(context)).toThrow('Required argument \'c\' is missing');
  });

  it('rejects wrong argument type', () => {
    expect(() => color('not a node' as any)).toThrow('Argument \'c\' must be one of: Color, Quoted');
  });
});
