import {
  red,
  blue,
  green,
  alpha
} from '../less/index.js';

import { Color, Context, Dimension, Num, type RuntimeFunction } from '@jesscss/core';
import { beforeAll, describe, it, expect } from 'vitest';

let context: Context;
let testColor: Color;

describe('color components', () => {
  beforeAll(() => {
    context = new Context();
    testColor = new Color('#ff0000'); // Red color
  });

  describe('red', () => {
    it('extracts red component from color', () => {
      const result = red(testColor);
      expect(result).toBeInstanceOf(Num);
      expect((result as Num).compare(new Num(255), undefined)).toBe(0);
    });

    it('works with object parameters', () => {
      const result = red({ color: testColor });
      expect(result).toBeInstanceOf(Num);
      expect((result as Num).compare(new Num(255), undefined)).toBe(0);
    });

    it('rejects wrong argument type', () => {
      expect(() => red(new Dimension({ number: 100, unit: 'px' }))).toThrow('Argument \'color\' must be of type \'Color\'');
    });

    it('rejects missing argument', () => {
      expect(() => red()).toThrow('Required argument \'color\' is missing');
    });
  });

  describe('blue', () => {
    it('extracts blue component from color', () => {
      const result = blue(testColor);
      expect(result).toBeInstanceOf(Num);
      expect((result as Num).compare(new Num(0), undefined)).toBe(0);
    });

    it('works with object parameters', () => {
      const result = blue({ color: testColor });
      expect(result).toBeInstanceOf(Num);
      expect((result as Num).compare(new Num(0), undefined)).toBe(0);
    });

    it('rejects wrong argument type', () => {
      expect(() => blue(new Num(100))).toThrow('Argument \'color\' must be of type \'Color\'');
    });

    it('rejects missing argument', () => {
      expect(() => (blue as RuntimeFunction).call(context)).toThrow('Required argument \'color\' is missing');
    });
  });

  describe('green', () => {
    it('extracts green component from color', () => {
      const result = green(testColor);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).compare(new Dimension({ number: 0, unit: '' }), undefined)).toBe(0);
    });

    it('works with object parameters', () => {
      const result = green({ color: testColor });
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).compare(new Dimension({ number: 0, unit: '' }), undefined)).toBe(0);
    });

    it('rejects wrong argument type', () => {
      expect(() => green('not a color')).toThrow('Argument \'color\' must be of type \'Color\'');
    });

    it('rejects missing argument', () => {
      expect(() => (green as RuntimeFunction).call(context)).toThrow('Required argument \'color\' is missing');
    });
  });

  describe('alpha', () => {
    it('extracts alpha component from color', () => {
      const result = alpha(testColor);
      expect(result).toBeInstanceOf(Num);
      expect((result as Num).compare(new Num(1))).toBe(0);
    });

    it('works with object parameters', () => {
      const result = alpha({ color: testColor });
      expect(result).toBeInstanceOf(Num);
      expect((result as Num).compare(new Num(1))).toBe(0);
    });

    it('rejects wrong argument type', () => {
      expect(() => alpha(new Dimension({ number: 100, unit: '%' }))).toThrow('Argument \'color\' must be of type \'Color\'');
    });

    it('rejects missing argument', () => {
      expect(() => (alpha as RuntimeFunction).call(context)).toThrow('Required argument \'color\' is missing');
    });
  });
});
