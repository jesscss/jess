import { describe, it, expect } from 'vitest';
import { Color, Dimension } from '@jesscss/core';
import opacify from '../opacify.js';
import fadeIn from '../fade-in.js';
import transparentize from '../transparentize.js';
import fadeOut from '../fade-out.js';
import adjustHue from '../adjust-hue.js';
import grayscale from '../grayscale.js';
import ieHexStr from '../ie-hex-str.js';

function isColorValue(value: unknown): value is Color {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Color';
}

function expectColor(value: unknown): Color {
  if (!isColorValue(value)) {
    throw new TypeError('Expected a Color result.');
  }
  return value;
}

describe('Sass color wrapper functions', () => {
  it('opacify() and fade-in() increase alpha by the same amount', () => {
    const input = new Color({ rgb: [128, 242, 13], alpha: 0.5 });
    const amount = new Dimension({ number: 10, unit: '%' });

    const opacified = expectColor(opacify(input, amount));
    const fadedIn = expectColor(fadeIn(input, amount));

    expect(opacified.alpha).toBeCloseTo(0.6);
    expect(fadedIn.alpha).toBeCloseTo(0.6);
    expect(opacified.rgb).toEqual(fadedIn.rgb);
  });

  it('transparentize() and fade-out() decrease alpha by the same amount', () => {
    const input = new Color({ rgb: [128, 242, 13], alpha: 0.5 });
    const amount = new Dimension({ number: 10, unit: '%' });

    const transparentized = expectColor(transparentize(input, amount));
    const fadedOut = expectColor(fadeOut(input, amount));

    expect(transparentized.alpha).toBeCloseTo(0.4);
    expect(fadedOut.alpha).toBeCloseTo(0.4);
    expect(transparentized.rgb).toEqual(fadedOut.rgb);
  });

  it('adjust-hue() rotates hue like Sass adjust-hue behavior', () => {
    const input = new Color({ hsl: [10, 0.9, 0.5], alpha: 1 });
    const result = expectColor(adjustHue(input, new Dimension({ number: 30, unit: 'deg' })));

    expect(result.hsl[0]).toBeCloseTo(40);
    expect(result.hsl[1]).toBeCloseTo(0.9);
    expect(result.hsl[2]).toBeCloseTo(0.5);
  });

  it('grayscale() removes saturation from color values', () => {
    const input = new Color({ hsl: [0, 1, 0.5], alpha: 1 });
    const result = expectColor(grayscale(input));

    expect(result.hsl[1]).toBeCloseTo(0);
    expect(result.rgb[0]).toBe(result.rgb[1]);
    expect(result.rgb[1]).toBe(result.rgb[2]);
  });

  it('ie-hex-str() returns ARGB hex format (#AARRGGBB)', () => {
    const input = new Color({ rgb: [90, 23, 148], alpha: 0.5 });
    const result = expectColor(ieHexStr(input));

    expect(result.node).toBe('#805a1794');
  });
});
