import { describe, it, expect } from 'vitest';
import { Color, ColorFormat, Dimension } from '@jesscss/core';
import spin from '../spin.js';

describe('spin()', () => {
  it('rotates hue positively and preserves alpha/format', () => {
    const color = new Color({
      hsl: [120, 0.5, 0.5],
      alpha: 0.4
    }, {
      format: ColorFormat.HSL
    });

    const result = spin(color, new Dimension({ number: 60, unit: 'deg' }));

    expect(result.hsl[0]).toBe(180);
    expect(result.alpha).toBe(0.4);
    expect(result.options.format).toBe(ColorFormat.HSL);
  });

  it('wraps hue for negative rotations', () => {
    const color = new Color({
      hsl: [10, 0.5, 0.5],
      alpha: 1
    });

    const result = spin(color, new Dimension({ number: -30, unit: 'deg' }));

    expect(result.hsl[0]).toBe(340);
  });
});
