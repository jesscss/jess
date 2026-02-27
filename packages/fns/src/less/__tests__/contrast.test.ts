import { describe, it, expect } from 'vitest';
import { Color, ColorFormat, Dimension } from '@jesscss/core';
import contrast from '../contrast.js';

describe('contrast()', () => {
  it('uses default dark/light pair and default threshold', () => {
    const darkColor = new Color('#222');
    const result = contrast(darkColor);

    expect(result).toBeInstanceOf(Color);
    expect(result.options.format).toBe(darkColor.options.format);
  });

  it('swaps light/dark arguments when passed in reverse luma order', () => {
    const source = new Color('#777');
    const dark = new Color('#fff');
    const light = new Color('#000');
    const result = contrast(source, dark, light);

    expect(result).toBeInstanceOf(Color);
    expect(result.options.format).toBe(source.options.format);
  });

  it('supports custom threshold as percentage dimension', () => {
    const source = new Color({ rgb: [120, 120, 120], alpha: 1 }, { format: ColorFormat.RGB });
    const dark = new Color('#000');
    const light = new Color('#fff');
    const threshold = new Dimension({ number: 60, unit: '%' });
    const result = contrast(source, dark, light, threshold);

    expect(result).toBeInstanceOf(Color);
    expect(result.options.format).toBe(ColorFormat.RGB);
  });
});
