import { describe, it, expect } from 'vitest';
import { Color } from '@jesscss/core';
import luma from '../luma.js';
import luminance from '../luminance.js';
import hsvhue from '../hsvhue.js';
import hsvsaturation from '../hsvsaturation.js';
import hsvvalue from '../hsvvalue.js';

describe('luma/luminance/hsv channels', () => {
  it('computes luma and luminance as percentages', () => {
    const color = new Color({
      rgb: [255, 0, 0],
      alpha: 0.5
    });

    const lumaResult = luma(color);
    const luminanceResult = luminance(color);

    expect(lumaResult.value.unit).toBe('%');
    expect(luminanceResult.value.unit).toBe('%');
    expect(lumaResult.value.number).toBeGreaterThan(0);
    expect(luminanceResult.value.number).toBeGreaterThan(0);
    expect(lumaResult.value.number).toBeCloseTo(luminanceResult.value.number, 10);
  });

  it('extracts hsv hue/saturation/value channels', () => {
    const color = new Color({
      rgb: [0, 255, 0],
      alpha: 1
    });

    const hue = hsvhue(color);
    const saturation = hsvsaturation(color);
    const value = hsvvalue(color);

    expect(hue.value.number).toBe(120);
    expect(saturation.value).toEqual({ number: 100, unit: '%' });
    expect(value.value).toEqual({ number: 100, unit: '%' });
  });
});
