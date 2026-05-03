import { describe, it, expect } from 'vitest';
import { Color, ColorFormat, Dimension, Num } from '../index.js';
import { Call, List } from '../index.js';
import { Context } from '../../context.js';

describe('Color Node', () => {
  describe('Constructor and Basic Properties', () => {
    it('should create color from RGB values', () => {
      const color = new Color({
        format: ColorFormat.RGB,
        rgb: [255, 0, 0],
        alpha: 1
      });

      expect(color.options.format).toBe(ColorFormat.RGB);
      expect(color.rgb).toEqual([255, 0, 0]);
      expect(color.alpha).toBe(1);
    });

    it('should create color from HSL values', () => {
      const color = new Color({
        format: ColorFormat.HSL,
        hsl: [0, 1, 0.5],
        alpha: 1
      });

      expect(color.options.format).toBe(ColorFormat.HSL);
      expect(color.hsl).toEqual([0, 1, 0.5]); // Clamped values (decimals)
      expect(color.alpha).toBe(1);
    });

    it('should create color from hex string', () => {
      const color = new Color('#ff0000');

      expect(color.options.format).toBe(ColorFormat.HEX);
      expect(color.rgb).toEqual([255, 0, 0]);
      expect(color.alpha).toBe(1);
    });

    it('should create color from hex string with alpha', () => {
      const color = new Color('#ff000080');

      expect(color.options.format).toBe(ColorFormat.HEX);
      expect(color.rgb).toEqual([255, 0, 0]);
      expect(color.alpha).toBeCloseTo(0.5, 2);
    });

    it('should create color from named color', () => {
      const color = new Color({
        format: ColorFormat.HEX,
        node: 'red',
        rgb: [255, 0, 0],
        alpha: 1
      });

      expect(color.options.format).toBe(ColorFormat.HEX);
      expect(color.rgb).toEqual([255, 0, 0]);
      expect(color.alpha).toBe(1);
    });
  });

  describe('Clamped vs Unclamped Values', () => {
    it('should clamp RGB values in public getter', () => {
      const color = new Color({
        format: ColorFormat.RGB,
        rgb: [300, -50, 128.7],
        alpha: 1
      });

      // Public getter should clamp
      expect(color.rgb).toEqual([255, 0, 129]);

      // Internal getter should preserve unclamped values
      expect(color._rgb).toEqual([300, -50, 128.7]);
    });

    it('should clamp HSL values in public getter', () => {
      const color = new Color({
        format: ColorFormat.HSL,
        hsl: [450, 1.5, -0.2],
        alpha: 1
      });

      // Public getter should clamp
      expect(color.hsl).toEqual([90, 1, 0]);

      // Internal getter should preserve unclamped values
      expect(color._hsl).toEqual([450, 1.5, -0.2]);
    });

    it('should clamp alpha value in public getter', () => {
      const color = new Color({
        format: ColorFormat.RGB,
        rgb: [255, 0, 0],
        alpha: 1.5
      });

      // Public getter should clamp
      expect(color.alpha).toBe(1);

      // Internal getter should preserve unclamped value
      expect(color._alpha).toBe(1.5);
    });
  });

  describe('RGB/HSL Conversion', () => {
    it('should convert RGB to HSL correctly', () => {
      const color = new Color({
        format: ColorFormat.RGB,
        rgb: [255, 0, 0],
        alpha: 1
      });

      expect(color.hsl).toEqual([0, 1, 0.5]);
    });

    it('should convert HSL to RGB correctly', () => {
      const color = new Color({
        format: ColorFormat.HSL,
        hsl: [0, 1, 0.5],
        alpha: 1
      });

      expect(color.rgb).toEqual([255, 0, 0]);
    });

    it('should handle grayscale colors', () => {
      const color = new Color({
        format: ColorFormat.RGB,
        rgb: [128, 128, 128],
        alpha: 1
      });

      expect(color.hsl[0]).toBeCloseTo(0, 2);
      expect(color.hsl[1]).toBeCloseTo(0, 2);
      expect(color.hsl[2]).toBeCloseTo(0.5, 2);
    });
  });

  describe('Operations', () => {
    it('should add colors correctly', () => {
      const color1 = new Color({
        format: ColorFormat.RGB,
        rgb: [100, 50, 25],
        alpha: 1
      });
      const color2 = new Color({
        format: ColorFormat.RGB,
        rgb: [50, 100, 75],
        alpha: 0.5
      });

      const result = color1.operate(color2, '+');

      expect(result.rgb).toEqual([150, 150, 100]);
      expect(result.alpha).toBe(1); // alpha blending: 1 * (1 - 0.5) + 0.5 = 1
    });

    it('should subtract colors correctly', () => {
      const color1 = new Color({
        format: ColorFormat.RGB,
        rgb: [200, 150, 100],
        alpha: 1
      });
      const color2 = new Color({
        format: ColorFormat.RGB,
        rgb: [50, 25, 10],
        alpha: 0.5
      });

      const result = color1.operate(color2, '-');

      expect(result.rgb).toEqual([150, 125, 90]);
    });

    it('should multiply colors correctly', () => {
      const color1 = new Color({
        format: ColorFormat.RGB,
        rgb: [100, 200, 50],
        alpha: 1
      });
      const color2 = new Color({
        format: ColorFormat.RGB,
        rgb: [2, 0.5, 3],
        alpha: 0.5
      });

      const result = color1.operate(color2, '*');

      expect(result.rgb).toEqual([200, 100, 150]);
    });

    it('should operate with numbers', () => {
      const color = new Color({
        format: ColorFormat.RGB,
        rgb: [100, 200, 50],
        alpha: 1
      });
      const num = new Num({ number: 2 });

      const result = color.operate(num, '*');

      expect(result.rgb).toEqual([200, 255, 100]);
    });

    it('should preserve format during operations', () => {
      const color1 = new Color({
        format: ColorFormat.HSL,
        hsl: [180, 0.5, 0.5],
        alpha: 1
      });
      const color2 = new Color({
        format: ColorFormat.HSL,
        hsl: [90, 0.25, 0.25],
        alpha: 0.5
      });

      const result = color1.operate(color2, '+');

      expect(result.options.format).toBe(ColorFormat.HSL);
    });
  });

  describe('Serialization', () => {
    it('should serialize RGB colors correctly', () => {
      const color = new Color({
        format: ColorFormat.RGB,
        rgb: [255, 0, 0],
        alpha: 1
      });

      expect(color.toTrimmedString()).toBe('rgb(255, 0, 0)');
    });

    it('should serialize RGB colors with default alpha correctly', () => {
      const color = new Color({
        format: ColorFormat.RGB,
        rgb: [255, 0, 0]
      });

      expect(color.toTrimmedString()).toBe('rgb(255, 0, 0)');
    });

    it('should serialize RGBA colors correctly', () => {
      const color = new Color({
        format: ColorFormat.RGB,
        rgb: [255, 0, 0],
        alpha: 0.5
      });

      expect(color.toTrimmedString()).toBe('rgba(255, 0, 0, 0.5)');
    });

    it('should serialize HSL colors correctly', () => {
      const color = new Color({
        format: ColorFormat.HSL,
        hsl: [180, 0.5, 0.5],
        alpha: 1
      });

      expect(color.toTrimmedString()).toBe('hsl(180, 50%, 50%)');
    });

    it('should serialize HSLA colors correctly', () => {
      const color = new Color({
        format: ColorFormat.HSL,
        hsl: [180, 0.5, 0.5],
        alpha: 0.5
      });

      expect(color.toTrimmedString()).toBe('hsla(180, 50%, 50%, 0.5)');
    });

    it('should serialize hex colors correctly', () => {
      const color = new Color('#ff0000');

      expect(color.toTrimmedString()).toBe('#ff0000');
    });

    it('renders color values through render(context)', () => {
      const rgbColor = new Color({
        format: ColorFormat.RGB,
        rgb: [255, 0, 0],
        alpha: 1
      });
      const hexColor = new Color('#ff0000');

      expect(rgbColor.render(new Context())).toBe('rgb(255, 0, 0)');
      expect(hexColor.render(new Context())).toBe('#ff0000');
      expect(rgbColor.evaluated).toBe(false);
      expect(rgbColor.preEvaluated).toBe(false);
      expect(hexColor.evaluated).toBe(false);
      expect(hexColor.preEvaluated).toBe(false);
    });

    it('resolves colors without touching render state', async () => {
      const context = new Context();
      const color = new Color({
        format: ColorFormat.RGB,
        rgb: [255, 0, 0],
        alpha: 1
      });

      const resolved = await color.resolve(context);

      expect(resolved.toTrimmedString()).toBe('rgb(255, 0, 0)');
      expect(context.printState.writer).toBeUndefined();
    });

    it('should preserve original function call syntax when node is present', () => {
      const callNode = new Call({
        name: 'rgba',
        args: new List([
          new Dimension({ number: 0, unit: '' }),
          new Dimension({ number: 0, unit: '' }),
          new Dimension({ number: 0, unit: '' }),
          new Dimension({ number: 0.1, unit: '' })
        ])
      });
      const color = new Color({
        format: ColorFormat.RGB,
        node: callNode,
        rgb: [0, 0, 0],
        alpha: 0.1
      });

      expect(color.toTrimmedString()).toBe('rgba(0, 0, 0, 0.1)');
    });

    it('should preserve string nodes (like hex strings)', () => {
      const color = new Color({
        format: ColorFormat.HEX,
        node: '#ff0000',
        rgb: [255, 0, 0],
        alpha: 1
      });

      expect(color.toTrimmedString()).toBe('#ff0000');
    });

    it('should fall back to standard format when no node is present', () => {
      const color = new Color({
        format: ColorFormat.RGB,
        rgb: [255, 0, 0],
        alpha: 1
      });

      expect(color.toTrimmedString()).toBe('rgb(255, 0, 0)');
    });
  });

  describe('Clamping During Serialization', () => {
    it('should clamp RGB values during serialization', () => {
      const color = new Color({
        format: ColorFormat.RGB,
        rgb: [300, -50, 128.7],
        alpha: 1
      });

      expect(color.toTrimmedString()).toBe('rgb(255, 0, 129)');
    });

    it('should clamp RGBA values during serialization', () => {
      const color = new Color({
        format: ColorFormat.RGB,
        rgb: [300, -50, 128.7],
        alpha: 0.5
      });

      expect(color.toTrimmedString()).toBe('rgba(255, 0, 129, 0.5)');
    });

    it('should clamp HSL values during serialization', () => {
      const color = new Color({
        format: ColorFormat.HSL,
        hsl: [450, 1.5, -0.2],
        alpha: 1
      });

      expect(color.toTrimmedString()).toBe('hsl(90, 100%, 0%)');
    });

    it('should clamp HSLA values during serialization', () => {
      const color = new Color({
        format: ColorFormat.HSL,
        hsl: [450, 1.5, -0.2],
        alpha: 0.5
      });

      expect(color.toTrimmedString()).toBe('hsla(90, 100%, 0%, 0.5)');
    });
  });

  describe('call-backed colors', () => {
    it('should preserve Call node for RGB function colors', () => {
      const args = [
        new Dimension({ number: 255, unit: '' }),
        new Dimension({ number: 0, unit: '' }),
        new Dimension({ number: 0, unit: '' })
      ];
      const callNode = new Call({ name: 'rgb', args });

      const color = new Color({
        node: callNode,
        rgb: [255, 0, 0],
        alpha: 1
      }, { format: ColorFormat.RGB });

      expect(color.options.format).toBe(ColorFormat.RGB);
      expect(color.value.node).toBeInstanceOf(Call);
      if (!(color.value.node instanceof Call)) {
        throw new TypeError('Expected color node to preserve RGB Call');
      }
      expect(color.value.node.value.name).toBe('rgb');
      expect(color.alpha).toBe(1);
    });

    it('should preserve Call node for HSL function colors', () => {
      const args = [
        new Dimension({ number: 0, unit: 'deg' }),
        new Dimension({ number: 100, unit: '%' }),
        new Dimension({ number: 50, unit: '%' })
      ];
      const callNode = new Call({ name: 'hsl', args });

      const color = new Color({
        node: callNode,
        hsl: [[0, 'deg'], [100, '%'], [50, '%']],
        alpha: 1
      }, { format: ColorFormat.HSL });

      expect(color.options.format).toBe(ColorFormat.HSL);
      expect(color.value.node).toBeInstanceOf(Call);
      if (!(color.value.node instanceof Call)) {
        throw new TypeError('Expected color node to preserve HSL Call');
      }
      expect(color.value.node.value.name).toBe('hsl');
      expect(color.alpha).toBe(1);
    });
  });

  describe('RGBA/HSLA Getters', () => {
    it('should return RGBA values correctly', () => {
      const color = new Color({
        format: ColorFormat.RGB,
        rgb: [255, 0, 0],
        alpha: 0.5
      });

      expect(color.rgba).toEqual([255, 0, 0, 0.5]);
    });

    it('should return HSLA values correctly', () => {
      const color = new Color({
        format: ColorFormat.HSL,
        hsl: [180, 0.5, 0.5],
        alpha: 0.5
      });

      expect(color.hsla).toEqual([180, 0.5, 0.5, 0.5]);
    });

    it('should set RGBA values correctly', () => {
      const color = new Color({
        format: ColorFormat.RGB,
        rgb: [0, 0, 0],
        alpha: 1
      });

      color.rgba = [255, 0, 0, 0.5];

      expect(color.rgb).toEqual([255, 0, 0]);
      expect(color.alpha).toBe(0.5);
    });

    it('should set HSLA values correctly', () => {
      const color = new Color({
        format: ColorFormat.HSL,
        hsl: [0, 0, 0],
        alpha: 1
      });

      color.hsla = [180, 50, 50, 0.5];

      expect(color.hsl).toEqual([180, 1, 1]);
      expect(color.alpha).toBe(0.5);
    });
  });

  describe('Error Handling', () => {
    it('should throw error for invalid color value', () => {
      expect(() => {
        new Color({
          format: ColorFormat.RGB,
          // Missing rgb and hsl
          alpha: 1
        });
      }).toThrow();
    });

    it('should throw error for invalid operation with dimension with unit', () => {
      const color = new Color({
        format: ColorFormat.RGB,
        rgb: [255, 0, 0],
        alpha: 1
      });
      const dimension = new Dimension({ number: 10, unit: 'px' });
      const context = new Context({ unitMode: 'strict' });

      expect(() => {
        color.operate(dimension, '+', context);
      }).toThrow('Cannot convert "10px" to a color');
    });

    it('should throw error for invalid operation with non-color', () => {
      const color = new Color({
        format: ColorFormat.RGB,
        rgb: [255, 0, 0],
        alpha: 1
      });
      const list = new List([]);

      expect(() => {
        color.operate(list, '+');
      }).toThrow('Cannot operate on List');
    });
  });
});
