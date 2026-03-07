import { Color, Context, Dimension, Num } from '@jesscss/core';
import { beforeAll, describe, it, expect } from 'vitest';
import hue from '../hue.js';
import saturation from '../saturation.js';
import lightness from '../lightness.js';
import lessHue from '../../less/hue.js';
import lessSaturation from '../../less/saturation.js';
import lessLightness from '../../less/lightness.js';

let context: Context;

describe('Sass HSL channel functions', () => {
  beforeAll(() => {
    context = new Context();
  });

  describe('hue()', () => {
    it('extracts hue from HSL color and returns Dimension with deg unit', () => {
      const color = new Color({ format: 2, hsl: [120, 0.5, 0.5] });
      const result = hue(color);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).value.number).toBe(120);
      expect((result as Dimension).value.unit).toBe('deg');
    });

    it('extracts hue from RGB color (converts to HSL)', () => {
      const color = new Color('#ff0000');
      const result = hue(color);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).value.unit).toBe('deg');
      const hueValue = (result as Dimension).value.number;
      expect(hueValue).toBeGreaterThanOrEqual(0);
      expect(hueValue).toBeLessThan(360);
    });

    it('works with object parameters', () => {
      const color = new Color({ format: 2, hsl: [180, 0.5, 0.5] });
      const result = hue({ color });
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).value.number).toBe(180);
      expect((result as Dimension).value.unit).toBe('deg');
    });

    it('differs from Less: Sass returns deg while Less returns unitless number', () => {
      const color = new Color({ format: 2, hsl: [210, 0.5, 0.5] });
      const sassResult = hue(color) as Dimension;
      const lessResult = lessHue(color) as Num;

      expect(sassResult.value.number).toBe(210);
      expect(sassResult.value.unit).toBe('deg');
      expect(lessResult).toBeInstanceOf(Num);
      expect(lessResult.value.number).toBe(210);
    });
  });

  describe('saturation()', () => {
    it('extracts saturation from HSL color and returns Dimension with % unit', () => {
      const color = new Color({ format: 2, hsl: [120, 0.5, 0.5] });
      const result = saturation(color);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).value.number).toBe(50);
      expect((result as Dimension).value.unit).toBe('%');
    });

    it('extracts saturation from RGB color (converts to HSL)', () => {
      const color = new Color('#ff0000');
      const result = saturation(color);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).value.unit).toBe('%');
      expect((result as Dimension).value.number).toBeGreaterThanOrEqual(0);
      expect((result as Dimension).value.number).toBeLessThanOrEqual(100);
    });

    it('works with object parameters', () => {
      const color = new Color({ format: 2, hsl: [120, 0.75, 0.5] });
      const result = saturation({ color });
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).value.number).toBe(75);
      expect((result as Dimension).value.unit).toBe('%');
    });

    it('matches Less behavior for value and percent unit', () => {
      const color = new Color({ format: 2, hsl: [120, 0.25, 0.5] });
      const sassResult = saturation(color) as Dimension;
      const lessResult = lessSaturation(color) as Dimension;

      expect(sassResult.value.number).toBe(25);
      expect(sassResult.value.unit).toBe('%');
      expect(lessResult.value.number).toBe(25);
      expect(lessResult.value.unit).toBe('%');
    });
  });

  describe('lightness()', () => {
    it('extracts lightness from HSL color and returns Dimension with % unit', () => {
      const color = new Color({ format: 2, hsl: [120, 0.5, 0.5] });
      const result = lightness(color);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).value.number).toBe(50);
      expect((result as Dimension).value.unit).toBe('%');
    });

    it('extracts lightness from RGB color (converts to HSL)', () => {
      const color = new Color('#ff0000');
      const result = lightness(color);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).value.unit).toBe('%');
      expect((result as Dimension).value.number).toBeGreaterThanOrEqual(0);
      expect((result as Dimension).value.number).toBeLessThanOrEqual(100);
    });

    it('works with object parameters', () => {
      const color = new Color({ format: 2, hsl: [120, 0.5, 0.25] });
      const result = lightness({ color });
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).value.number).toBe(25);
      expect((result as Dimension).value.unit).toBe('%');
    });

    it('matches Less behavior for value and percent unit', () => {
      const color = new Color({ format: 2, hsl: [120, 0.5, 0.3] });
      const sassResult = lightness(color) as Dimension;
      const lessResult = lessLightness(color) as Dimension;

      expect(sassResult.value.number).toBe(30);
      expect(sassResult.value.unit).toBe('%');
      expect(lessResult.value.number).toBe(30);
      expect(lessResult.value.unit).toBe('%');
    });
  });
});
