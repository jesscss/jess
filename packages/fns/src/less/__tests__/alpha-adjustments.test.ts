import { describe, it, expect } from 'vitest';
import { Any, Color, ColorFormat, Dimension } from '@jesscss/core';
import fade from '../fade.js';
import fadein from '../fadein.js';
import fadeout from '../fadeout.js';
import greyscale from '../greyscale.js';

describe('less alpha and grayscale adjustments', () => {
  it('fade() sets alpha; an OPAQUE hex turns translucent as rgba (not hex)', () => {
    const color = new Color('#ff0000');
    const result = fade(color, new Dimension({ number: 25, unit: '%' }));
    expect(result.alpha).toBe(0.25);
    // #ff0000 carried no alpha channel → becomes RGB once translucent (4.x/v5 parity)
    expect(result.options.format).toBe(ColorFormat.RGB);
  });

  it('fade() preserves hex format when the input hex encoded an alpha channel', () => {
    const color = new Color('#ff000080'); // 8-digit hex → alpha already present
    const result = fade(color, new Dimension({ number: 25, unit: '%' }));
    expect(result.alpha).toBe(0.25);
    expect(result.options.format).toBe(ColorFormat.HEX);
  });

  it('fadein()/fadeout() support relative method', () => {
    const color = new Color({
      rgb: [10, 20, 30],
      alpha: 0.5
    });
    const relative = new Any('relative', { role: 'keyword' });

    const fadedIn = fadein(color, new Dimension({ number: 20, unit: '%' }), relative);
    const fadedOut = fadeout(color, new Dimension({ number: 20, unit: '%' }), relative);

    expect(fadedIn.alpha).toBeCloseTo(0.6, 12);
    expect(fadedOut.alpha).toBeCloseTo(0.4, 12);
  });

  it('greyscale() zeroes saturation while preserving format and alpha', () => {
    const color = new Color({
      hsl: [120, 0.75, 0.4],
      alpha: 0.3
    }, { format: ColorFormat.HSL });
    const result = greyscale(color);
    expect(result.hsl[1]).toBe(0);
    expect(result.alpha).toBe(0.3);
    expect(result.options.format).toBe(ColorFormat.HSL);
  });
});
