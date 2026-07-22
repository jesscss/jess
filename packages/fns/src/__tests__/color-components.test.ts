import {
  red,
  blue,
  green,
  alpha
} from '../less/index.js';

import { makeColorRgb, makeDimension, makeKeyword, RGB, type Color } from '@jesscss/core/value';
import { describe, it, expect } from 'vitest';

let testColor: Color;

describe('color components', () => {
  testColor = makeColorRgb([255, 0, 0], 1, RGB);

  describe('red', () => {
    it('extracts red component from color', () => {
      const result = red(testColor);
      expect(result).toMatchObject({ type: 'Dimension', number: 255, unit: '' });
    });

    it('works with object parameters', () => {
      const result = red({ color: testColor });
      expect(result).toMatchObject({ type: 'Dimension', number: 255, unit: '' });
    });

    it('rejects wrong argument type', () => {
      expect(() => red(makeDimension(100, 'px'))).toThrow('red: arg 0 expected Color, got Dimension');
    });

    it('rejects missing argument', () => {
      expect(() => red()).toThrow('red: missing required argument color');
    });
  });

  describe('blue', () => {
    it('extracts blue component from color', () => {
      const result = blue(testColor);
      expect(result).toMatchObject({ type: 'Dimension', number: 0, unit: '' });
    });

    it('works with object parameters', () => {
      const result = blue({ color: testColor });
      expect(result).toMatchObject({ type: 'Dimension', number: 0, unit: '' });
    });

    it('rejects wrong argument type', () => {
      expect(() => blue(makeDimension(100))).toThrow('blue: arg 0 expected Color, got Dimension');
    });

    it('rejects missing argument', () => {
      expect(() => blue()).toThrow('blue: missing required argument color');
    });
  });

  describe('green', () => {
    it('extracts green component from color', () => {
      const result = green(testColor);
      expect(result).toMatchObject({ type: 'Dimension', number: 0, unit: '' });
    });

    it('works with object parameters', () => {
      const result = green({ color: testColor });
      expect(result).toMatchObject({ type: 'Dimension', number: 0, unit: '' });
    });

    it('rejects wrong argument type', () => {
      expect(() => green(makeKeyword('not a color'))).toThrow('green: arg 0 expected Color, got Keyword');
    });

    it('rejects missing argument', () => {
      expect(() => green()).toThrow('green: missing required argument color');
    });
  });

  describe('alpha', () => {
    it('extracts alpha component from color', () => {
      const result = alpha(testColor);
      expect(result).toMatchObject({ type: 'Dimension', number: 1, unit: '' });
    });

    it('works with object parameters', () => {
      const result = alpha({ color: testColor });
      expect(result).toMatchObject({ type: 'Dimension', number: 1, unit: '' });
    });

    it('rejects wrong argument type', () => {
      expect(() => alpha(makeDimension(100, '%'))).toThrow('alpha: arg 0 expected Color, got Dimension');
    });

    it('rejects missing argument', () => {
      expect(() => alpha()).toThrow('alpha: missing required argument color');
    });
  });
});
