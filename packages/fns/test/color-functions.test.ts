import { describe, it, expect } from 'vitest';
import { defineFunction, Color, ColorFormat, Dimension } from '@jesscss/core';
import {
  percentOf,
  angleToDegrees,
  normalizeHue,
  alphaToNumber,
  toNumber
} from '@jesscss/core';
import rgb from '../src/less/rgb';
import rgba from '../src/less/rgba';
import hsl from '../src/less/hsl';
import hsla from '../src/less/hsla';

describe('Color Functions', () => {
  describe('RGB Function', () => {
    it('should handle absolute RGB values', async () => {
      const r = new Dimension({ number: 255, unit: '' });
      const g = new Dimension({ number: 0, unit: '' });
      const b = new Dimension({ number: 0, unit: '' });

      const result = await rgb(r, g, b);
      expect(result).toBeInstanceOf(Color);
      expect(result.value.format).toBe(ColorFormat.RGB);
      expect(result.rgb).toEqual([255, 0, 0]);
      expect(result.alpha).toBe(1);
    });

    it('should convert percentage RGB values', async () => {
      const r = new Dimension({ number: 50, unit: '%' });  // 50% of 255 = 127.5
      const g = new Dimension({ number: 100, unit: '%' }); // 100% of 255 = 255
      const b = new Dimension({ number: 0, unit: '%' });   // 0% of 255 = 0

      const result = await rgb(r, g, b);
      expect(result._rgb).toEqual([127.5, 255, 0]);
    });

    it('should handle mixed percentage and absolute values', async () => {
      const r = new Dimension({ number: 50, unit: '%' });  // 50% of 255 = 127.5
      const g = new Dimension({ number: 255, unit: '' });  // Absolute value
      const b = new Dimension({ number: 0, unit: '%' });   // 0% of 255 = 0

      const result = await rgb(r, g, b);
      expect(result._rgb).toEqual([127.5, 255, 0]);
    });

    it('should handle sequence syntax (comma-less)', async () => {
      // This would be parsed as a sequence: rgb(255 0 0)
      // The splitSequence option should handle this
      const r = new Dimension({ number: 255, unit: '' });
      const g = new Dimension({ number: 0, unit: '' });
      const b = new Dimension({ number: 0, unit: '' });

      const result = await rgb(r, g, b);
      expect(result.rgb).toEqual([255, 0, 0]);
    });
  });

  describe('RGBA Function', () => {
    it('should handle absolute RGBA values', async () => {
      const r = new Dimension({ number: 255, unit: '' });
      const g = new Dimension({ number: 0, unit: '' });
      const b = new Dimension({ number: 0, unit: '' });
      const a = new Dimension({ number: 0.5, unit: '' });

      const result = await rgba(r, g, b, a);
      expect(result.rgb).toEqual([255, 0, 0]);
      expect(result.alpha).toBe(0.5);
    });

    it('should convert percentage alpha values', async () => {
      const r = new Dimension({ number: 255, unit: '' });
      const g = new Dimension({ number: 0, unit: '' });
      const b = new Dimension({ number: 0, unit: '' });
      const a = new Dimension({ number: 60, unit: '%' }); // 60% = 0.6

      const result = await rgba(r, g, b, a);
      expect(result.alpha).toBe(0.6);
    });

    it('should clamp alpha values to 0-1 range', async () => {
      const r = new Dimension({ number: 255, unit: '' });
      const g = new Dimension({ number: 0, unit: '' });
      const b = new Dimension({ number: 0, unit: '' });
      const a1 = new Dimension({ number: 150, unit: '%' }); // Should clamp to 1
      const a2 = new Dimension({ number: -10, unit: '%' }); // Should clamp to 0

      const result1 = await rgba(r, g, b, a1);
      const result2 = await rgba(r, g, b, a2);
      expect(result1.alpha).toBe(1);
      expect(result2.alpha).toBe(0);
    });

    it('should handle mixed percentage RGB and alpha', async () => {
      const r = new Dimension({ number: 50, unit: '%' });  // 50% of 255 = 127.5
      const g = new Dimension({ number: 100, unit: '%' }); // 100% of 255 = 255
      const b = new Dimension({ number: 0, unit: '%' });   // 0% of 255 = 0
      const a = new Dimension({ number: 80, unit: '%' });  // 80% = 0.8

      const result = await rgba(r, g, b, a);
      expect(result._rgb).toEqual([127.5, 255, 0]);
      expect(result._alpha).toBe(0.8);
    });
  });

  describe('HSL Function', () => {
    it('should handle degrees for hue', async () => {
      const h = new Dimension({ number: 180, unit: 'deg' });
      const s = new Dimension({ number: 50, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });

      const result = await hsl(h, s, l);
      expect(result.value.format).toBe(ColorFormat.HSL);
      expect(result._hsl).toEqual([180, 0.5, 0.5]);
      expect(result._alpha).toBe(1);
    });

    it('should convert turns to degrees for hue', async () => {
      const h = new Dimension({ number: 0.5, unit: 'turn' }); // 0.5 turn = 180 degrees
      const s = new Dimension({ number: 50, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });

      const result = await hsl(h, s, l);
      expect(result.hsl[0]).toBe(180);
    });

    it('should convert radians to degrees for hue', async () => {
      const h = new Dimension({ number: Math.PI, unit: 'rad' }); // π rad = 180 degrees
      const s = new Dimension({ number: 50, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });

      const result = await hsl(h, s, l);
      expect(result.hsl[0]).toBeCloseTo(180, 1);
    });

    it('should convert gradians to degrees for hue', async () => {
      const h = new Dimension({ number: 100, unit: 'grad' }); // 100 grad = 90 degrees
      const s = new Dimension({ number: 50, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });

      const result = await hsl(h, s, l);
      expect(result.hsl[0]).toBe(90);
    });

    it('should handle percentage hue values', async () => {
      const h = new Dimension({ number: 50, unit: '%' }); // 50% of 360 = 180 degrees
      const s = new Dimension({ number: 50, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });

      const result = await hsl(h, s, l);
      expect(result.hsl[0]).toBe(180);
    });

    it('should normalize hue values to 0-360 range', async () => {
      const h1 = new Dimension({ number: 400, unit: 'deg' }); // Should normalize to 40
      const h2 = new Dimension({ number: -30, unit: 'deg' }); // Should normalize to 330
      const s = new Dimension({ number: 50, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });

      const result1 = await hsl(h1, s, l);
      const result2 = await hsl(h2, s, l);
      expect(result1.hsl[0]).toBe(40);
      expect(result2.hsl[0]).toBe(330);
    });

    it('should handle unitless hue values', async () => {
      const h = new Dimension({ number: 180, unit: '' });
      const s = new Dimension({ number: 50, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });

      const result = await hsl(h, s, l);
      expect(result.hsl[0]).toBe(180);
    });

    it('should convert saturation and lightness percentages', async () => {
      const h = new Dimension({ number: 180, unit: 'deg' });
      const s = new Dimension({ number: 75, unit: '%' }); // 75% = 0.75
      const l = new Dimension({ number: 25, unit: '%' }); // 25% = 0.25

      const result = await hsl(h, s, l);
      expect(result._hsl[1]).toBe(0.75);
      expect(result._hsl[2]).toBe(0.25);
    });

    it('should handle unitless saturation and lightness', async () => {
      const h = new Dimension({ number: 180, unit: 'deg' });
      const s = new Dimension({ number: 0.5, unit: '' });
      const l = new Dimension({ number: 0.5, unit: '' });

      const result = await hsl(h, s, l);
      expect(result.hsl[1]).toBe(0.5);
      expect(result.hsl[2]).toBe(0.5);
    });
  });

  describe('HSLA Function', () => {
    const hsla = defineFunction(
      'hsla',
      function(this: any, h: number, s: number, l: number, a: number) {
        return new Color({
          format: ColorFormat.HSL,
          hsl: [h, s, l],
          alpha: a
        });
      },
      {
        params: [
          { name: 'h', type: Dimension, convert: [normalizeHue(), toNumber()] },
          { name: 's', type: Dimension, convert: [percentOf(100), toNumber()] },
          { name: 'l', type: Dimension, convert: [percentOf(100), toNumber()] },
          { name: 'a', type: Dimension, convert: [alphaToNumber(), toNumber()] }
        ],
        splitSequence: true
      }
    );

    it('should handle all HSL angle units with alpha', () => {
      const h1 = new Dimension({ number: 0.5, unit: 'turn' }); // 0.5 turn = 180 degrees
      const h2 = new Dimension({ number: Math.PI, unit: 'rad' }); // π rad = 180 degrees
      const h3 = new Dimension({ number: 50, unit: '%' }); // 50% of 360 = 180 degrees
      const s = new Dimension({ number: 50, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });
      const a = new Dimension({ number: 0.8, unit: '' });

      const result1 = hsla(h1, s, l, a);
      const result2 = hsla(h2, s, l, a);
      const result3 = hsla(h3, s, l, a);

      expect(result1.hsl[0]).toBe(180);
      expect(result1.alpha).toBe(0.8);
      expect(result2.hsl[0]).toBeCloseTo(180, 1);
      expect(result3.hsl[0]).toBe(180);
    });

    it('should convert percentage alpha values', () => {
      const h = new Dimension({ number: 180, unit: 'deg' });
      const s = new Dimension({ number: 50, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });
      const a = new Dimension({ number: 60, unit: '%' }); // 60% = 0.6

      const result = hsla(h, s, l, a);
      expect(result.alpha).toBe(0.6);
    });

    it('should clamp alpha values', () => {
      const h = new Dimension({ number: 180, unit: 'deg' });
      const s = new Dimension({ number: 50, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });
      const a1 = new Dimension({ number: 150, unit: '%' }); // Should clamp to 1
      const a2 = new Dimension({ number: -10, unit: '%' }); // Should clamp to 0

      const result1 = hsla(h, s, l, a1);
      const result2 = hsla(h, s, l, a2);
      expect(result1.alpha).toBe(1);
      expect(result2.alpha).toBe(0);
    });
  });

  describe('MDN Specification Compliance', () => {
    const rgb = defineFunction(
      'rgb',
      function(this: any, r: number, g: number, b: number) {
        return new Color({
          format: ColorFormat.RGB,
          rgb: [r, g, b],
          alpha: 1
        });
      },
      {
        params: [
          { name: 'r', type: Dimension, convert: [percentOf(255), toNumber()] },
          { name: 'g', type: Dimension, convert: [percentOf(255), toNumber()] },
          { name: 'b', type: Dimension, convert: [percentOf(255), toNumber()] }
        ],
        splitSequence: true
      }
    );

    it('should support rgb(255 255 255) syntax', () => {
      const r = new Dimension({ number: 255, unit: '' });
      const g = new Dimension({ number: 255, unit: '' });
      const b = new Dimension({ number: 255, unit: '' });

      const result = rgb(r, g, b);
      expect(result.rgb).toEqual([255, 255, 255]);
    });

    it('should support rgb(100% 50% 0%) syntax', () => {
      const r = new Dimension({ number: 100, unit: '%' });
      const g = new Dimension({ number: 50, unit: '%' });
      const b = new Dimension({ number: 0, unit: '%' });

      const result = rgb(r, g, b);
      expect(result._rgb).toEqual([255, 127.5, 0]);
    });

    it('should support hsl(0deg 100% 50%) syntax', async () => {
      const h = new Dimension({ number: 0, unit: 'deg' });
      const s = new Dimension({ number: 100, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });

      const result = await hsl(h, s, l);
      expect(result._hsl).toEqual([0, 1, 0.5]);
    });

    it('should support hsl(0 100% 50%) syntax (unitless hue)', async () => {
      const h = new Dimension({ number: 0, unit: '' });
      const s = new Dimension({ number: 100, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });

      const result = await hsl(h, s, l);
      expect(result._hsl).toEqual([0, 1, 0.5]);
    });

    it('should support hsl(0.5turn 100% 50%) syntax', async () => {
      const h = new Dimension({ number: 0.5, unit: 'turn' });
      const s = new Dimension({ number: 100, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });

      const result = await hsl(h, s, l);
      expect(result.hsl[0]).toBe(180);
    });

    it('should support hsl(3.14159rad 100% 50%) syntax', async () => {
      const h = new Dimension({ number: Math.PI, unit: 'rad' });
      const s = new Dimension({ number: 100, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });

      const result = await hsl(h, s, l);
      expect(result.hsl[0]).toBeCloseTo(180, 1);
    });

    it('should support hsl(200grad 100% 50%) syntax', async () => {
      const h = new Dimension({ number: 200, unit: 'grad' });
      const s = new Dimension({ number: 100, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });

      const result = await hsl(h, s, l);
      expect(result.hsl[0]).toBe(180);
    });

    it('should support hsl(50% 100% 50%) syntax (percentage hue)', async () => {
      const h = new Dimension({ number: 50, unit: '%' });
      const s = new Dimension({ number: 100, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });

      const result = await hsl(h, s, l);
      expect(result.hsl[0]).toBe(180);
    });

    it('should normalize hue values correctly', async () => {
      const h1 = new Dimension({ number: 400, unit: 'deg' });
      const h2 = new Dimension({ number: -30, unit: 'deg' });
      const h3 = new Dimension({ number: 390, unit: 'deg' });
      const s = new Dimension({ number: 100, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });

      const result1 = await hsl(h1, s, l);
      const result2 = await hsl(h2, s, l);
      const result3 = await hsl(h3, s, l);

      expect(result1.hsl[0]).toBe(40);
      expect(result2.hsl[0]).toBe(330);
      expect(result3.hsl[0]).toBe(30);
    });
  });
});
