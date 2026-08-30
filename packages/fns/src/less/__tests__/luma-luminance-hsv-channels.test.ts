import { describe, it, expect } from 'vitest';
import {
  colorRawRgb,
  colorRgbRounded,
  makeColorHsl,
  makeColorRgb,
  makeDimension,
  HSL,
  RGB,
  type Color
} from '@jesscss/core';
import { lessFns } from '../registry.js';
import { hue } from '../hue.js';
import { saturation } from '../saturation.js';
import { lightness } from '../lightness.js';
import { luma } from '../luma.js';
import { luminance } from '../luminance.js';
import { hsvhue } from '../hsvhue.js';
import { hsvsaturation } from '../hsvsaturation.js';
import { hsvvalue } from '../hsvvalue.js';
import { toHsv } from '../color-helper.js';

function legacyLuminanceOracle(color: Color): { number: number; bytes: string } {
  const [r, g, b] = colorRgbRounded(color);
  const luminance =
    (0.2126 * r / 255)
    + (0.7152 * g / 255)
    + (0.0722 * b / 255);
  const result = makeDimension(luminance * Math.min(Math.max(color.alpha, 0), 1) * 100, '%');
  return { number: result.number, bytes: result.bytes };
}

describe('luma/luminance/hsv channels', () => {
  it('computes luma and luminance as percentages', () => {
    const color = makeColorRgb([255, 0, 0], 0.5, RGB);

    const lumaResult = luma(color);
    const luminanceResult = luminance(color);
    const expected = legacyLuminanceOracle(color);

    expect(lumaResult.unit).toBe('%');
    expect(luminanceResult.unit).toBe('%');
    expect(lumaResult.number).toBeGreaterThan(0);
    expect(luminanceResult.number).toBeGreaterThan(0);
    expect(lumaResult.number).toBeCloseTo(luminanceResult.number, 10);
    expect(luminanceResult.number).toBe(expected.number);
    expect(luminanceResult.bytes).toBe(expected.bytes);
  });

  it('extracts hsv hue/saturation/value channels', () => {
    const color = makeColorRgb([0, 255, 0], 1, RGB);

    const hueResult = hsvhue(color);
    const saturationResult = hsvsaturation(color);
    const value = hsvvalue(color);

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
    expect(lessFns.find(fn => fn.name === 'hue')).toBe(hue);
    expect(lessFns.find(fn => fn.name === 'saturation')).toBe(saturation);
    expect(lessFns.find(fn => fn.name === 'lightness')).toBe(lightness);
    expect(lessFns.find(fn => fn.name === 'luma')).toBe(luma);
    expect(lessFns.find(fn => fn.name === 'luminance')).toBe(luminance);
  });

  it('matches the legacy luminance oracle across source shapes and channel bounds', () => {
    const vectors = [
      makeColorRgb([255, 0, 0], 0.5, RGB),
      makeColorRgb([64.4, 127.6, 0.2], 0.5, RGB),
      makeColorHsl([210, 0.333333, 0.444444], 0.7, HSL),
      makeColorRgb([-10, 300, 128.9], 1.1, RGB),
      makeColorHsl([-20, 0.2, 0.8], 0.25, HSL),
      makeColorRgb([0, 0, 0], -0.5, RGB),
      makeColorRgb([255, 255, 255], 2, RGB)
    ];

    for (const color of vectors) {
      const expected = legacyLuminanceOracle(color);
      const result = luminance(color);
      expect(result.number).toBe(expected.number);
      expect(result.bytes).toBe(expected.bytes);
      expect(result.unit).toBe('%');
    }
  });

  it('matches the legacy luminance oracle over deterministic random RGB/HSL vectors', () => {
    let seed = 0x12345678;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    for (let index = 0; index < 1024; index++) {
      const color = index % 2 === 0
        ? makeColorRgb(
            [random() * 400 - 100, random() * 400 - 100, random() * 400 - 100],
            random() * 2 - 0.5,
            RGB
          )
        : makeColorHsl(
            [random() * 900 - 450, random() * 2 - 0.5, random() * 2 - 0.5],
            random() * 2 - 0.5,
            HSL
          );
      const expected = legacyLuminanceOracle(color);
      const result = luminance(color);
      expect(result.number).toBe(expected.number);
      expect(result.bytes).toBe(expected.bytes);
    }
  });

  it('matches the pre-cutover HSV oracle byte-for-byte across source shapes', () => {
    const vectors = [
      makeColorRgb([64.4, 127.6, 0.2], 0.5, RGB),
      makeColorHsl([210, 0.333333, 0.444444], 0.7, HSL),
      makeColorRgb([-10, 300, 128.9], 1.1, RGB),
      makeColorHsl([-20, 0.2, 0.8], 0.25, HSL)
    ];

    for (const color of vectors) {
      /*
       * `toHsv` is the exact pre-cutover Less reader oracle. The canonical
       * value must receive the raw source RGB so HSL-backed colors retain the
       * same unrounded channel facts the old reader used.
       */
      const [h, s, v] = toHsv(color);
      const typedColor = makeColorRgb(colorRawRgb(color), color.alpha, RGB);
      const expectedHue = makeDimension(h).bytes;
      const expectedSaturation = makeDimension(s * 100, '%').bytes;
      const expectedValue = makeDimension(v * 100, '%').bytes;

      expect(hsvhue(typedColor).bytes).toBe(expectedHue);
      expect(hsvsaturation(typedColor).bytes).toBe(expectedSaturation);
      expect(hsvvalue(typedColor).bytes).toBe(expectedValue);
    }
  });

  it('registers the canonical HSV readers without a legacy wrapper', () => {
    expect(lessFns.find(fn => fn.name === 'hsvhue')).toBe(hsvhue);
    expect(lessFns.find(fn => fn.name === 'hsvsaturation')).toBe(hsvsaturation);
    expect(lessFns.find(fn => fn.name === 'hsvvalue')).toBe(hsvvalue);
  });
});
