import { ColorFormat, color, dimension, num } from '..';
import { Context } from '../../context';

let context: Context;

describe('Color', () => {
  beforeEach(() => {
    context = new Context();
  });

  describe('constructor', () => {
    it('should create color from hex string', () => {
      const node = color('#fff');
      expect(node.value).toEqual({
        node: '#fff',
        format: ColorFormat.HEX
      });
      expect(node.rgba).toEqual([255, 255, 255, 1]);
    });

    it('should create color from color array', () => {
      const node = color([255, 128, 64, 0.5]);
      expect(node.value).toEqual({
        rgba: [255, 128, 64, 0.5],
        format: ColorFormat.RGB
      });
    });

    it('should create color from ColorData object', () => {
      const node = color({
        node: 'red',
        format: ColorFormat.RGB,
        rgba: [255, 0, 0, 1]
      });
      expect(node.value).toEqual({
        node: 'red',
        format: ColorFormat.RGB,
        rgba: [255, 0, 0, 1]
      });
    });

    it('should throw error for invalid constructor input', () => {
      expect(() => color(ColorFormat.RGB as any)).toThrow('Color constructor requires ColorData object, hex string, or color array');
    });
  });

  describe('rgba getter/setter', () => {
    it('should get rgba from stored value', () => {
      const node = color([255, 128, 64, 0.5]);
      expect(node.rgba).toEqual([255, 128, 64, 0.5]);
    });

    it('should get rgba from hex string', () => {
      const node = color('#ff8040');
      expect(node.rgba).toEqual([255, 128, 64, 1]);
    });

    it('should get rgba from 3-digit hex', () => {
      const node = color('#f80');
      expect(node.rgba).toEqual([255, 136, 0, 1]);
    });

    it('should set rgba and update value', () => {
      const node = color('#000');
      node.rgba = [255, 128, 64, 0.5];
      expect(node.value.rgba).toEqual([255, 128, 64, 0.5]);
      expect(node.rgba).toEqual([255, 128, 64, 0.5]);
    });

    it('should clear hsl cache when setting rgba', () => {
      const node = color('#fff');
      // Access hsla to populate cache
      node.hsla;
      node.rgba = [255, 0, 0, 1];
      // Should recalculate hsl
      expect(node.hsla[0]).toBeCloseTo(0, 1); // Red should be hue 0
    });
  });

  describe('rgb getter/setter', () => {
    it('should get rgb values', () => {
      const node = color([255, 128, 64, 0.5]);
      expect(node.rgb).toEqual([255, 128, 64]);
    });

    it('should set rgb values preserving alpha', () => {
      const node = color([255, 128, 64, 0.5]);
      node.rgb = [100, 200, 50];
      expect(node.rgba).toEqual([100, 200, 50, 0.5]);
    });
  });

  describe('alpha getter/setter', () => {
    it('should get alpha value', () => {
      const node = color([255, 128, 64, 0.5]);
      expect(node.alpha).toBe(0.5);
    });

    it('should set alpha value preserving rgb', () => {
      const node = color([255, 128, 64, 0.5]);
      node.alpha = 0.8;
      expect(node.rgba).toEqual([255, 128, 64, 0.8]);
    });
  });

  describe('hsla getter/setter', () => {
    it('should get hsla values', () => {
      const node = color('#ff0000'); // Red
      const hsla = node.hsla;
      expect(hsla[0]).toBeCloseTo(0, 1); // Hue 0 for red
      expect(hsla[1]).toBeCloseTo(1, 1); // Saturation 100%
      expect(hsla[2]).toBeCloseTo(0.5, 1); // Lightness 50%
      expect(hsla[3]).toBe(1); // Alpha 1
    });

    it('should set hsla values and convert to rgb', () => {
      const node = color('#000000');
      node.hsla = [0, 1, 0.5, 0.8]; // Red with 80% alpha
      expect(node.rgba[0]).toBeCloseTo(255, 0); // Red component
      expect(node.rgba[1]).toBeCloseTo(0, 0); // Green component
      expect(node.rgba[2]).toBeCloseTo(0, 0); // Blue component
      expect(node.rgba[3]).toBe(0.8); // Alpha
    });

    it('should handle pure white in hsl', () => {
      const node = color('#000000');
      node.hsla = [0, 0, 1, 1]; // Any hue, 0% saturation, 100% lightness
      expect(node.rgba).toEqual([255, 255, 255, 1]);
    });

    it('should handle pure black in hsl', () => {
      const node = color('#ffffff');
      node.hsla = [0, 0, 0, 1]; // Any hue, 0% saturation, 0% lightness
      expect(node.rgba).toEqual([0, 0, 0, 1]);
    });

    it('should handle pure gray in hsl', () => {
      const node = color('#000000');
      node.hsla = [0, 0, 0.5, 1]; // Any hue, 0% saturation, 50% lightness
      expect(node.rgba[0]).toBeCloseTo(128, 0);
      expect(node.rgba[1]).toBeCloseTo(128, 0);
      expect(node.rgba[2]).toBeCloseTo(128, 0);
      expect(node.rgba[3]).toBe(1);
    });
  });

  describe('color conversion clamping', () => {
    it('should preserve raw values during operations', () => {
      const node1 = color([255, 255, 255, 1]);
      const node2 = color([1, 1, 1, 1]);
      const result = node1.operate(node2, '+');
      // Operations should preserve raw mathematical results
      expect(result.rgba[0]).toBe(256); // 255 + 1 = 256
      expect(result.rgba[1]).toBe(256);
      expect(result.rgba[2]).toBe(256);
    });

    it('should preserve negative values during operations', () => {
      const node1 = color([0, 0, 0, 1]);
      const node2 = color([100, 100, 100, 1]);
      const result = node1.operate(node2, '-');
      // Operations should preserve raw mathematical results
      expect(result.rgba[0]).toBe(-100); // 0 - 100 = -100
      expect(result.rgba[1]).toBe(-100);
      expect(result.rgba[2]).toBe(-100);
    });

    it('should clamp values during serialization', () => {
      const node = color([300, -50, 128, 1.5]); // Values outside valid ranges
      // Raw values should be preserved
      expect(node.rgba[0]).toBe(300);
      expect(node.rgba[1]).toBe(-50);
      expect(node.rgba[2]).toBe(128);
      expect(node.alpha).toBe(1.5);
      
      // But serialization should clamp
      const serialized = node.toString();
      expect(serialized).toContain('rgb(255, 0, 128)'); // Clamped values
    });

    it('should handle hsl values outside normal ranges', () => {
      const node = color('#000000');
      node.hsla = [400, 1.5, -0.2, 2]; // Values outside normal ranges
      // Raw values should be preserved
      expect(node.hsla[0]).toBe(400);
      expect(node.hsla[1]).toBe(1.5);
      expect(node.hsla[2]).toBe(-0.2);
      expect(node.hsla[3]).toBe(2);
    });
  });

  describe('serialization', () => {
    it('should serialize hex color preserving original format', () => {
      const node = color('#fff');
      expect(node.toString()).toBe('#fff');
    });

    it('should serialize rgb color', () => {
      const node = color({
        format: ColorFormat.RGB,
        rgba: [255, 255, 255, 1]
      });
      expect(node.toString()).toBe('rgb(255, 255, 255)');
    });

    it('should serialize rgba color', () => {
      const node = color({
        format: ColorFormat.RGB,
        rgba: [255, 255, 255, 0.5]
      });
      expect(node.toString()).toBe('rgba(255, 255, 255, 0.5)');
    });

    it('should serialize hsl color', () => {
      const node = color({
        format: ColorFormat.HSL,
        rgba: [255, 255, 255, 1]
      });
      expect(node.toString()).toBe('hsl(0, 0%, 100%)');
    });

    it('should serialize hsla color', () => {
      const node = color({
        format: ColorFormat.HSL,
        rgba: [255, 255, 255, 0.5]
      });
      expect(node.toString()).toBe('hsla(0, 0%, 100%, 0.5)');
    });

    it('should serialize color with original node representation', () => {
      const node = color({
        node: 'red',
        format: ColorFormat.RGB,
        rgba: [255, 0, 0, 1]
      });
      expect(node.toString()).toBe('red');
    });
  });

  describe('operations', () => {
    it('should add colors', () => {
      const left = color('#111');
      const right = color('#222');
      const result = left.operate(right, '+');
      expect(result.toString()).toBe('#333333');
    });

    it('should subtract colors', () => {
      const left = color('#222');
      const right = color('#111');
      const result = left.operate(right, '-');
      expect(result.toString()).toBe('#111111');
    });

    it('should multiply color by number', () => {
      const left = color('#222');
      const right = num(2);
      const result = left.operate(right, '*');
      expect(result.toString()).toBe('#444444');
    });

    it('should divide color by number', () => {
      const left = color('#222');
      const right = num(2);
      const result = left.operate(right, '/');
      expect(result.toString()).toBe('#111111');
    });

    it('should preserve format in operations', () => {
      const left = color({
        format: ColorFormat.HSL,
        rgba: [255, 0, 0, 1]
      });
      const right = num(0.5);
      const result = left.operate(right, '*');
      expect(result.value.format).toBe(ColorFormat.HSL);
    });
  });

  describe('errors', () => {
    it('should throw when adding incompatible units', () => {
      const left = color('#fff');
      const right = dimension([2, 'rem']);
      expect(() => left.operate(right, '+', context)).toThrow();
    });

    it('should throw when adding incompatible units (reversed)', () => {
      const left = dimension([2, 'rem']);
      const right = color('#fff');
      expect(() => left.operate(right, '+', context)).toThrow();
    });

    it('should throw when hex string is invalid', () => {
      expect(() => color('#invalid')).toThrow('Cannot convert color value to rgba');
    });

    it('should throw when ColorData has no rgba and no parseable node', () => {
      const node = color({
        format: ColorFormat.RGB
      });
      expect(() => node.rgba).toThrow('Cannot convert color value to rgba');
    });
  });
});