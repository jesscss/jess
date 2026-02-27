import { describe, it, expect } from 'vitest';
import { Color, ColorFormat, Dimension } from '@jesscss/core';
import mix from '../mix.js';

describe('mix()', () => {
  it('uses default 50% weight when omitted', () => {
    const color1 = new Color({ rgb: [255, 0, 0], alpha: 1 }, { format: ColorFormat.RGB });
    const color2 = new Color({ rgb: [0, 0, 255], alpha: 1 }, { format: ColorFormat.RGB });

    const result = mix(color1, color2);

    expect(result).toBeInstanceOf(Color);
    expect(result.options.format).toBe(ColorFormat.RGB);
    expect(result.rgb[0]).toBe(128);
    expect(result.rgb[2]).toBe(128);
    expect(result.alpha).toBe(1);
  });

  it('applies custom weight and alpha blending', () => {
    const color1 = new Color({ rgb: [255, 0, 0], alpha: 0.2 }, { format: ColorFormat.RGB });
    const color2 = new Color({ rgb: [0, 0, 255], alpha: 0.8 }, { format: ColorFormat.RGB });
    const weight = new Dimension({ number: 25, unit: '%' });

    const result = mix(color1, color2, weight);

    expect(result).toBeInstanceOf(Color);
    expect(result.alpha).toBeCloseTo(0.65, 6);
    expect(result.options.format).toBe(ColorFormat.RGB);
  });
});
