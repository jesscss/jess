import { describe, it, expect } from 'vitest';
import { Color } from '@jesscss/core';
import { makeColorRgb, RGB } from '@jesscss/core/value';
import { builtinLessFns } from '../../builtins/index.js';
import { hue as builtinHue } from '../../builtins/hue.js';
import { saturation as builtinSaturation } from '../../builtins/saturation.js';
import { lightness as builtinLightness } from '../../builtins/lightness.js';
import { luma as builtinLuma } from '../../builtins/luma.js';
import hue from '../hue.js';
import saturation from '../saturation.js';
import lightness from '../lightness.js';
import luma from '../luma.js';
import luminance from '../luminance.js';
import hsvhue from '../hsvhue.js';
import hsvsaturation from '../hsvsaturation.js';
import hsvvalue from '../hsvvalue.js';

describe('luma/luminance/hsv channels', () => {
  it('computes luma and luminance as percentages', () => {
    const legacyColor = new Color({
      rgb: [255, 0, 0],
      alpha: 0.5
    });
    const color = makeColorRgb([255, 0, 0], 0.5, RGB);

    const lumaResult = luma(color);
    const luminanceResult = luminance(legacyColor);

    expect(lumaResult.unit).toBe('%');
    expect(luminanceResult.unit).toBe('%');
    expect(lumaResult.number).toBeGreaterThan(0);
    expect(luminanceResult.number).toBeGreaterThan(0);
    expect(lumaResult.number).toBeCloseTo(luminanceResult.number, 10);
  });

  it('extracts hsv hue/saturation/value channels', () => {
    const legacyColor = new Color({
      rgb: [0, 255, 0],
      alpha: 1
    });
    const color = makeColorRgb([0, 255, 0], 1, RGB);

    const hueResult = hsvhue(legacyColor);
    const saturationResult = hsvsaturation(legacyColor);
    const value = hsvvalue(legacyColor);

    expect(hueResult.number).toBe(120);
    expect(saturationResult.number).toBe(100);
    expect(saturationResult.unit).toBe('%');
    expect(value.number).toBe(100);
    expect(value.unit).toBe('%');

    expect(hue(color)).toMatchObject({ type: 'Dimension', number: 120, unit: '' });
    expect(saturation(color)).toMatchObject({ type: 'Dimension', number: 100, unit: '%' });
    expect(lightness(color)).toMatchObject({ type: 'Dimension', number: 50, unit: '%' });
  });

  it('uses the canonical implementations registered for Less', () => {
    expect(hue).toBe(builtinHue);
    expect(saturation).toBe(builtinSaturation);
    expect(lightness).toBe(builtinLightness);
    expect(luma).toBe(builtinLuma);
    expect(builtinLessFns.find(fn => fn.name === 'hue')).toBe(builtinHue);
    expect(builtinLessFns.find(fn => fn.name === 'saturation')).toBe(builtinSaturation);
    expect(builtinLessFns.find(fn => fn.name === 'lightness')).toBe(builtinLightness);
    expect(builtinLessFns.find(fn => fn.name === 'luma')).toBe(builtinLuma);
  });
});
