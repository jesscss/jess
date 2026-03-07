import { Color, Dimension, Context } from '@jesscss/core';
import { beforeAll, describe, it, expect } from 'vitest';
import opacity from '../opacity.js';

let context: Context;

describe('Sass opacity() function', () => {
  beforeAll(() => {
    context = new Context();
  });

  describe('opacity() with color', () => {
    it('extracts alpha from color with full opacity', () => {
      const color = new Color('#ff0000');
      const result = opacity(color);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).value.number).toBe(1);
      expect((result as Dimension).value.unit).toBeUndefined();
    });

    it('extracts alpha from color with partial opacity', () => {
      const color = new Color({ format: 1, rgb: [255, 0, 0], alpha: 0.5 });
      const result = opacity(color);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).value.number).toBe(0.5);
      expect((result as Dimension).value.unit).toBeUndefined();
    });

    it('extracts alpha from transparent color', () => {
      const color = new Color({ format: 1, rgb: [255, 0, 0], alpha: 0 });
      const result = opacity(color);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).value.number).toBe(0);
    });

    it('works with object parameters', () => {
      const color = new Color({ format: 1, rgb: [255, 0, 0], alpha: 0.75 });
      const result = opacity({ color: color });
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).value.number).toBe(0.75);
    });
  });

  describe('opacity() with number (CSS filter passthrough)', () => {
    it('passes through dimension for CSS filter function', () => {
      const number = new Dimension({ number: 50, unit: '%' });
      const result = opacity(number);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).value.number).toBe(50);
      expect((result as Dimension).value.unit).toBe('%');
    });

    it('passes through unitless number', () => {
      const number = new Dimension({ number: 0.5 });
      const result = opacity(number);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).value.number).toBe(0.5);
    });
  });
});
