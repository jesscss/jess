import {
  darken,
  lighten,
  saturate,
  desaturate
} from '../less/index.js';

import { Color, Context, Dimension, Quoted } from '@jesscss/core';
import { beforeAll, describe, it, expect } from 'vitest';

let context: Context;
let testColor: Color;
let amount: Dimension;

describe('color adjustments', () => {
  beforeAll(() => {
    context = new Context();
    testColor = new Color('#ff0000'); // Red color
    amount = new Dimension({ number: 20, unit: '%' });
  });

  describe('darken', () => {
    it('darkens a color', () => {
      const result = darken(testColor, amount);
      expect(result).toBeInstanceOf(Color);
    });

    it('works with object parameters', () => {
      const result = darken({ color: testColor, amount });
      expect(result).toBeInstanceOf(Color);
    });

    it('works with optional method parameter', () => {
      const method = new Quoted('relative');
      const result = darken(testColor, amount, method);
      expect(result).toBeInstanceOf(Color);
    });

    it('rejects wrong color type', () => {
      // @ts-expect-error - wrong argument type
      expect(() => darken('not a color', amount)).toThrow('Argument \'color\' must be of type \'Color\'');
    });

    it('rejects wrong amount type', () => {
      // @ts-expect-error - wrong argument type
      expect(() => darken(testColor, 'not a dimension')).toThrow('Argument \'amount\' must be of type \'Dimension\'');
    });

    it('rejects missing color argument', () => {
      // @ts-expect-error - missing argument
      expect(() => darken({ amount })).toThrow('Required argument \'color\' is missing');
    });

    it('rejects missing amount argument', () => {
      // @ts-expect-error - missing argument
      expect(() => darken({ color: testColor })).toThrow('Required argument \'amount\' is missing');
    });
  });

  describe('lighten', () => {
    it('lightens a color', () => {
      const result = lighten(testColor, amount);
      expect(result).toBeInstanceOf(Color);
    });

    it('works with object parameters', () => {
      const result = lighten({ color: testColor, amount });
      expect(result).toBeInstanceOf(Color);
    });

    it('works with optional method parameter', () => {
      const method = new Quoted('absolute');
      const result = lighten(testColor, amount, method);
      expect(result).toBeInstanceOf(Color);
    });

    it('rejects wrong color type', () => {
      // @ts-expect-error - wrong argument type
      expect(() => lighten(new Dimension({ number: 100, unit: 'px' }), amount)).toThrow('Argument \'color\' must be of type \'Color\'');
    });

    it('rejects wrong amount type', () => {
      // @ts-expect-error - wrong argument type
      expect(() => lighten(testColor, new Quoted('20%'))).toThrow('Argument \'amount\' must be of type \'Dimension\'');
    });

    it('rejects missing color argument', () => {
      // @ts-expect-error - missing argument
      expect(() => lighten({ amount })).toThrow('Required argument \'color\' is missing');
    });

    it('rejects missing amount argument', () => {
      // @ts-expect-error - missing argument
      expect(() => lighten({ color: testColor })).toThrow('Required argument \'amount\' is missing');
    });
  });

  describe('saturate', () => {
    it('saturates a color', () => {
      const result = saturate(testColor, amount);
      expect(result).toBeInstanceOf(Color);
    });

    it('works with object parameters', () => {
      const result = saturate({ color: testColor, amount });
      expect(result).toBeInstanceOf(Color);
    });

    it('works with optional method parameter', () => {
      const method = new Quoted('relative');
      const result = saturate(testColor, amount, method);
      expect(result).toBeInstanceOf(Color);
    });

    it('rejects wrong color type', () => {
      // @ts-expect-error - wrong argument type
      expect(() => saturate('red', amount)).toThrow('Argument \'color\' must be of type \'Color\'');
    });

    it('rejects wrong amount type', () => {
      // @ts-expect-error - wrong argument type
      expect(() => saturate(testColor, 20)).toThrow('Argument \'amount\' must be of type \'Dimension\'');
    });

    it('rejects missing color argument', () => {
      // @ts-expect-error - missing argument
      expect(() => saturate({ amount })).toThrow('Required argument \'color\' is missing');
    });

    it('rejects missing amount argument', () => {
      // @ts-expect-error - missing argument
      expect(() => saturate({ color: testColor })).toThrow('Required argument \'amount\' is missing');
    });
  });

  describe('desaturate', () => {
    it('desaturates a color', () => {
      const result = desaturate(testColor, amount);
      expect(result).toBeInstanceOf(Color);
    });

    it('works with object parameters', () => {
      const result = desaturate({ color: testColor, amount });
      expect(result).toBeInstanceOf(Color);
    });

    it('works with optional method parameter', () => {
      const method = new Quoted('absolute');
      const result = desaturate(testColor, amount, method);
      expect(result).toBeInstanceOf(Color);
    });

    it('rejects wrong color type', () => {
      // @ts-expect-error - wrong argument type
      expect(() => desaturate(new Quoted('#ff0000'), amount)).toThrow('Argument \'color\' must be of type \'Color\'');
    });

    it('rejects wrong amount type', () => {
      // @ts-expect-error - wrong argument type
      expect(() => desaturate(testColor, 'not a dimension')).toThrow('Argument \'amount\' must be of type \'Dimension\'');
    });

    it('rejects missing color argument', () => {
      // @ts-expect-error - missing argument
      expect(() => desaturate({ amount })).toThrow('Required argument \'color\' is missing');
    });

    it('rejects missing amount argument', () => {
      // @ts-expect-error - missing argument
      expect(() => desaturate({ color: testColor })).toThrow('Required argument \'amount\' is missing');
    });
  });
});
