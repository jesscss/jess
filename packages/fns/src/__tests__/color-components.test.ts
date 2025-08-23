import {
  red,
  blue,
  green,
  alpha
} from '../less';

import { Color, Context, Dimension, Num } from '@jesscss/core';
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
      expect(red(testColor)).toMatchObject(new Num(255));
    });

    it('works with object parameters', () => {
      expect(red({ color: testColor })).toMatchObject(new Num(255));
    });

    it('rejects wrong argument type', () => {
      // @ts-expect-error - wrong argument type
      expect(() => red(new Dimension({ number: 100, unit: 'px' }))).toThrow('Required argument \'color\' is missing');
    });

    it('rejects missing argument', () => {
      // @ts-expect-error - missing argument
      expect(() => red()).toThrow('Required argument \'color\' is missing');
    });
  });

  describe('blue', () => {
    it('extracts blue component from color', () => {
      expect(blue(testColor)).toMatchObject(new Num(0));
    });

    it('works with object parameters', () => {
      expect(blue({ color: testColor })).toMatchObject(new Num(0));
    });

    it('rejects wrong argument type', () => {
      // @ts-expect-error - wrong argument type
      expect(() => blue(new Num(100))).toThrow('Required argument \'color\' is missing');
    });

    it('rejects missing argument', () => {
      // @ts-expect-error - missing argument
      expect(() => blue.call(context)).toThrow('Required argument \'color\' is missing');
    });
  });

  describe('green', () => {
    it('extracts green component from color', () => {
      expect(green(testColor)).toMatchObject(new Dimension({ number: 0, unit: '' }));
    });

    it('works with object parameters', () => {
      expect(green({ color: testColor })).toMatchObject(new Dimension({ number: 0, unit: '' }));
    });

    it('rejects wrong argument type', () => {
      // @ts-expect-error - wrong argument type
      expect(() => green('not a color')).toThrow('Argument \'color\' must be of type \'Color\'');
    });

    it('rejects missing argument', () => {
      // @ts-expect-error - missing argument
      expect(() => green.call(context)).toThrow('Required argument \'color\' is missing');
    });
  });

  describe('alpha', () => {
    it('extracts alpha component from color', () => {
      expect(alpha(testColor)).toMatchObject(new Num(1));
    });

    it('works with object parameters', () => {
      expect(alpha({ color: testColor })).toMatchObject(new Num(1));
    });

    it('rejects wrong argument type', () => {
      // @ts-expect-error - wrong argument type
      expect(() => alpha(new Dimension({ number: 100, unit: '%' }))).toThrow('Required argument \'color\' is missing');
    });

    it('rejects missing argument', () => {
      // @ts-expect-error - missing argument
      expect(() => alpha.call(context)).toThrow('Required argument \'color\' is missing');
    });
  });
});
