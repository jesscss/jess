import { Color, Context, Dimension } from '@jesscss/core';
import { beforeAll, describe, it, expect } from 'vitest';
import hue from '../sass/hue.js';
import saturation from '../sass/saturation.js';
import lightness from '../sass/lightness.js';

let context: Context;

describe('Sass HSL channel functions', () => {
  beforeAll(() => {
    context = new Context();
  });

  describe('hue()', () => {
    it('extracts hue from HSL color and returns Dimension with deg unit', () => {
      const color = new Color({ format: 2, hsl: [120, 0.5, 0.5] }); // hsl(120, 50%, 50%)
      const result = hue(color);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).number).toBe(120);
      expect((result as Dimension).unit).toBe('deg');
    });

    it('extracts hue from RGB color (converts to HSL)', () => {
      const color = new Color('#ff0000'); // Red - hue should be 0
      const result = hue(color);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).unit).toBe('deg');
      // Hue for red should be close to 0 (or 360)
      const hueValue = (result as Dimension).number;
      expect(hueValue).toBeGreaterThanOrEqual(0);
      expect(hueValue).toBeLessThan(360);
    });

    it('works with object parameters', () => {
      const color = new Color({ format: 2, hsl: [180, 0.5, 0.5] });
      const result = hue({ color });
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).number).toBe(180);
      expect((result as Dimension).unit).toBe('deg');
    });
  });

  describe('saturation()', () => {
    it('extracts saturation from HSL color and returns Dimension with % unit', () => {
      const color = new Color({ format: 2, hsl: [120, 0.5, 0.5] }); // hsl(120, 50%, 50%)
      const result = saturation(color);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).number).toBe(50);
      expect((result as Dimension).unit).toBe('%');
    });

    it('extracts saturation from RGB color (converts to HSL)', () => {
      const color = new Color('#ff0000'); // Red
      const result = saturation(color);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).unit).toBe('%');
      expect((result as Dimension).number).toBeGreaterThanOrEqual(0);
      expect((result as Dimension).number).toBeLessThanOrEqual(100);
    });

    it('works with object parameters', () => {
      const color = new Color({ format: 2, hsl: [120, 0.75, 0.5] });
      const result = saturation({ color });
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).number).toBe(75);
      expect((result as Dimension).unit).toBe('%');
    });
  });

  describe('lightness()', () => {
    it('extracts lightness from HSL color and returns Dimension with % unit', () => {
      const color = new Color({ format: 2, hsl: [120, 0.5, 0.5] }); // hsl(120, 50%, 50%)
      const result = lightness(color);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).number).toBe(50);
      expect((result as Dimension).unit).toBe('%');
    });

    it('extracts lightness from RGB color (converts to HSL)', () => {
      const color = new Color('#ff0000'); // Red
      const result = lightness(color);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).unit).toBe('%');
      expect((result as Dimension).number).toBeGreaterThanOrEqual(0);
      expect((result as Dimension).number).toBeLessThanOrEqual(100);
    });

    it('works with object parameters', () => {
      const color = new Color({ format: 2, hsl: [120, 0.5, 0.25] });
      const result = lightness({ color });
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).number).toBe(25);
      expect((result as Dimension).unit).toBe('%');
    });
  });
});
