import { describe, it, expect } from 'vitest';
import { Color, ColorFormat, Dimension } from '@jesscss/core';
import tint from '../tint.js';

describe('tint()', () => {
  it('tints color and preserves source format', () => {
    const color = new Color({ rgb: [50, 100, 200], alpha: 1 }, { format: ColorFormat.HSL });
    const result = tint(color, new Dimension({ number: 25, unit: '%' }));

    expect(result).toBeInstanceOf(Color);
    expect(result.options.format).toBe(ColorFormat.HSL);
    expect(result.alpha).toBe(1);
  });

  it('keeps fractional alpha when output is not effectively 1', () => {
    const color = new Color({ rgb: [50, 100, 200], alpha: 0.4 }, { format: ColorFormat.RGB });
    const result = tint(color, new Dimension({ number: 30, unit: '%' }));

    expect(result).toBeInstanceOf(Color);
    expect(result.alpha).toBeLessThan(1);
  });
});
