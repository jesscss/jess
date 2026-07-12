import { describe, it, expect } from 'vitest';
import { defineFunction } from '../src/define-function.js';
import { Dimension, Num } from '../src/tree/index.js';
import {
  percentOf,
  angleToDegrees,
  normalizeHue,
  alphaToNumber,
  toNumber,
  lengthToPx,
  timeToMs,
  frequencyToHz,
  angleToRadians
} from '../src/conversions.js';

describe('Conversion Plugins', () => {
  describe('percentOf', () => {
    it('should convert percentage to fraction of base value', () => {
      const converter = percentOf(255);
      const input = new Dimension({ number: 50, unit: '%' });
      const result = converter(input);

      expect(result).toBeInstanceOf(Num);
      expect((result as Num).number).toBe(127.5); // 50% of 255
    });

    it('should pass through non-percentage values', () => {
      const converter = percentOf(255);
      const input = new Dimension({ number: 100, unit: 'px' });
      const result = converter(input);

      expect(result).toBe(input);
    });

    it('should work with different base values', () => {
      const converter = percentOf(100);
      const input = new Dimension({ number: 75, unit: '%' });
      const result = converter(input);

      expect((result as Num).number).toBe(75); // 75% of 100
    });
  });

  describe('angleToDegrees', () => {
    it('should convert turns to degrees', () => {
      const converter = angleToDegrees();
      const input = new Dimension({ number: 0.5, unit: 'turn' });
      const result = converter(input);

      expect((result as Num).number).toBe(180); // 0.5 turn = 180 degrees
    });

    it('should convert radians to degrees', () => {
      const converter = angleToDegrees();
      const input = new Dimension({ number: Math.PI, unit: 'rad' });
      const result = converter(input);

      expect((result as Num).number).toBe(180); // π radians = 180 degrees
    });

    it('should convert gradians to degrees', () => {
      const converter = angleToDegrees();
      const input = new Dimension({ number: 100, unit: 'grad' });
      const result = converter(input);

      expect((result as Num).number).toBe(90); // 100 grad = 90 degrees
    });

    it('should pass through degrees and unitless values', () => {
      const converter = angleToDegrees();
      const degInput = new Dimension({ number: 45, unit: 'deg' });
      const unitlessInput = new Dimension({ number: 90, unit: '' });

      expect(converter(degInput)).toBeInstanceOf(Num);
      expect((converter(degInput) as Num).number).toBe(45);
      expect(converter(unitlessInput)).toBeInstanceOf(Num);
      expect((converter(unitlessInput) as Num).number).toBe(90);
    });
  });

  describe('normalizeHue', () => {
    it('should normalize hue values to 0-360 range', () => {
      const converter = normalizeHue();

      // Test various inputs
      expect((converter(new Dimension({ number: 400, unit: 'deg' })) as Num).number).toBe(40);
      expect((converter(new Dimension({ number: -30, unit: 'deg' })) as Num).number).toBe(330);
      expect((converter(new Dimension({ number: 1.5, unit: 'turn' })) as Num).number).toBe(180);
    });

    it('should handle percentage inputs', () => {
      const converter = normalizeHue();
      const input = new Dimension({ number: 50, unit: '%' });
      const result = converter(input);

      expect((result as Num).number).toBe(180); // 50% of 360 = 180
    });
  });

  describe('alphaToNumber', () => {
    it('should convert percentage alpha to 0-1 range', () => {
      const converter = alphaToNumber();
      const input = new Dimension({ number: 60, unit: '%' });
      const result = converter(input);

      expect((result as Num).number).toBe(0.6); // 60% = 0.6
    });

    it('should clamp values to 0-1 range', () => {
      const converter = alphaToNumber();

      expect((converter(new Dimension({ number: 150, unit: '%' })) as Num).number).toBe(1);
      expect((converter(new Dimension({ number: -10, unit: '%' })) as Num).number).toBe(0);
    });

    it('should handle unitless values', () => {
      const converter = alphaToNumber();
      const input = new Dimension({ number: 0.8, unit: '' });
      const result = converter(input);

      expect((result as Num).number).toBe(0.8);
    });
  });

  describe('toNumber', () => {
    it('should convert any dimension to number', () => {
      const converter = toNumber();
      const input = new Dimension({ number: 42, unit: 'px' });
      const result = converter(input);

      expect((result as Num).number).toBe(42);
    });
  });

  describe('lengthToPx', () => {
    it('should convert various length units to pixels', () => {
      const converter = lengthToPx(16); // 16px base font size

      expect((converter(new Dimension({ number: 1, unit: 'em' })) as Num).number).toBe(16);
      expect((converter(new Dimension({ number: 1, unit: 'rem' })) as Num).number).toBe(16);
      expect((converter(new Dimension({ number: 1, unit: 'in' })) as Num).number).toBe(96);
      expect((converter(new Dimension({ number: 1, unit: 'cm' })) as Num).number).toBeCloseTo(37.8, 1);
    });
  });

  describe('timeToMs', () => {
    it('should convert time units to milliseconds', () => {
      const converter = timeToMs();

      expect((converter(new Dimension({ number: 1, unit: 's' })) as Num).number).toBe(1000);
      expect((converter(new Dimension({ number: 500, unit: 'ms' })) as Num).number).toBe(500);
    });
  });

  describe('frequencyToHz', () => {
    it('should convert frequency units to hertz', () => {
      const converter = frequencyToHz();

      expect((converter(new Dimension({ number: 1, unit: 'khz' })) as Num).number).toBe(1000);
      expect((converter(new Dimension({ number: 440, unit: 'hz' })) as Num).number).toBe(440);
    });
  });

  describe('angleToRadians', () => {
    it('should convert angle units to radians', () => {
      const converter = angleToRadians();

      expect((converter(new Dimension({ number: 180, unit: 'deg' })) as Num).number).toBe(Math.PI);
      expect((converter(new Dimension({ number: 0.5, unit: 'turn' })) as Num).number).toBe(Math.PI);
    });
  });
});

describe('defineFunction with Conversion Plugins', () => {
  describe('RGB function with percentage conversion', () => {
    const rgb = defineFunction(
      'rgb',
      function(this: any, r: number, g: number, b: number) {
        return `rgb(${r}, ${g}, ${b})`;
      },
      {
        params: [
          { name: 'r', type: Dimension, convert: [percentOf(255), toNumber()] },
          { name: 'g', type: Dimension, convert: [percentOf(255), toNumber()] },
          { name: 'b', type: Dimension, convert: [percentOf(255), toNumber()] }
        ]
      }
    );

    it('should convert percentage RGB values', () => {
      const r = new Dimension({ number: 50, unit: '%' });  // 50% of 255 = 127.5
      const g = new Dimension({ number: 100, unit: '%' }); // 100% of 255 = 255
      const b = new Dimension({ number: 0, unit: '%' });   // 0% of 255 = 0

      const result = rgb(r, g, b);
      expect(result).toBe('rgb(127.5, 255, 0)');
    });

    it('should handle mixed percentage and absolute values', () => {
      const r = new Dimension({ number: 50, unit: '%' });  // 50% of 255 = 127.5
      const g = new Dimension({ number: 255, unit: '' });  // Absolute value
      const b = new Dimension({ number: 0, unit: '%' });   // 0% of 255 = 0

      const result = rgb(r, g, b);
      expect(result).toBe('rgb(127.5, 255, 0)');
    });
  });

  describe('HSL function with angle and percentage conversion', () => {
    const hsl = defineFunction(
      'hsl',
      function(this: any, h: number, s: number, l: number) {
        return `hsl(${h}deg, ${s}%, ${l}%)`;
      },
      {
        params: [
          { name: 'h', type: Dimension, convert: [normalizeHue(), toNumber()] },
          { name: 's', type: Dimension, convert: [percentOf(100), toNumber()] },
          { name: 'l', type: Dimension, convert: [percentOf(100), toNumber()] }
        ]
      }
    );

    it('should convert various angle units for hue', () => {
      const h1 = new Dimension({ number: 0.5, unit: 'turn' }); // 0.5 turn = 180 degrees
      const h2 = new Dimension({ number: Math.PI, unit: 'rad' }); // π rad = 180 degrees
      const h3 = new Dimension({ number: 50, unit: '%' }); // 50% of 360 = 180 degrees

      const s = new Dimension({ number: 50, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });

      expect(hsl(h1, s, l)).toBe('hsl(180deg, 50%, 50%)');
      expect(hsl(h2, s, l)).toBe('hsl(180deg, 50%, 50%)');
      expect(hsl(h3, s, l)).toBe('hsl(180deg, 50%, 50%)');
    });

    it('should normalize hue values', () => {
      const h = new Dimension({ number: 400, unit: 'deg' }); // Should normalize to 40
      const s = new Dimension({ number: 50, unit: '%' });
      const l = new Dimension({ number: 50, unit: '%' });

      expect(hsl(h, s, l)).toBe('hsl(40deg, 50%, 50%)');
    });
  });

  describe('RGBA function with alpha conversion', () => {
    const rgba = defineFunction(
      'rgba',
      function(this: any, r: number, g: number, b: number, a: number) {
        return `rgba(${r}, ${g}, ${b}, ${a})`;
      },
      {
        params: [
          { name: 'r', type: Dimension, convert: [percentOf(255), toNumber()] },
          { name: 'g', type: Dimension, convert: [percentOf(255), toNumber()] },
          { name: 'b', type: Dimension, convert: [percentOf(255), toNumber()] },
          { name: 'a', type: Dimension, convert: [alphaToNumber(), toNumber()] }
        ]
      }
    );

    it('should convert percentage alpha values', () => {
      const r = new Dimension({ number: 255, unit: '' });
      const g = new Dimension({ number: 0, unit: '' });
      const b = new Dimension({ number: 0, unit: '' });
      const a = new Dimension({ number: 60, unit: '%' }); // 60% = 0.6

      expect(rgba(r, g, b, a)).toBe('rgba(255, 0, 0, 0.6)');
    });

    it('should clamp alpha values', () => {
      const r = new Dimension({ number: 255, unit: '' });
      const g = new Dimension({ number: 0, unit: '' });
      const b = new Dimension({ number: 0, unit: '' });
      const a = new Dimension({ number: 150, unit: '%' }); // Should clamp to 1

      expect(rgba(r, g, b, a)).toBe('rgba(255, 0, 0, 1)');
    });
  });

  describe('Multiple conversion plugins chaining', () => {
    const complexFunction = defineFunction(
      'complex',
      function(this: any, value: number) {
        return `result: ${value}`;
      },
      {
        params: [
          {
            name: 'value',
            type: Dimension,
            convert: [
              percentOf(100),    // Convert percentage to fraction of 100
              angleToDegrees(),  // Convert angles to degrees
              toNumber()         // Convert to number
            ]
          }
        ]
      }
    );

    it('should chain multiple conversions', () => {
      // 50% of 100 = 50, then angle conversion (no effect), then to number
      const input = new Dimension({ number: 50, unit: '%' });
      expect(complexFunction(input)).toBe('result: 50');

      // 0.5 turn = 180 degrees, then to number
      const angleInput = new Dimension({ number: 0.5, unit: 'turn' });
      expect(complexFunction(angleInput)).toBe('result: 180');
    });
  });
});
