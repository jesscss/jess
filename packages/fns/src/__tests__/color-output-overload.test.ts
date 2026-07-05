import { Color, Context, callWithContext } from '@jesscss/core';
import rgba from '../less/rgba.js';
import rgb from '../less/rgb.js';
import hsla from '../less/hsla.js';
import { describe, it, expect } from 'vitest';

/**
 * Regression: the single-color overloads `rgba(color)` / `hsla(color)` / `rgb(color)`
 * route through `formatColorOutput`, which crashed reading `input.location.length`
 * for any Color built without a Parseman location (e.g. a hex color parsed from a
 * fixture). The result: the whole call fell back to source rendering
 * (`rgba(#5F59)` instead of `rgba(85, 255, 85, 0.6)`).
 */
describe('single-color color-format overloads', () => {
  it('rgba(#5F59) reformats the color (no location required)', async () => {
    const context = new Context();
    const result = await callWithContext(context, rgba, new Color('#5F59'));
    expect(result).toBeInstanceOf(Color);
    expect(String(result)).toBe('rgba(85, 255, 85, 0.6)');
  });

  it('rgb(#55FF5599) reformats to rgba with alpha', async () => {
    const context = new Context();
    const result = await callWithContext(context, rgb, new Color('#55FF5599'));
    expect(String(result)).toBe('rgba(85, 255, 85, 0.6)');
  });

  it('hsla(#5F59) reformats the color', async () => {
    const context = new Context();
    const result = await callWithContext(context, hsla, new Color('#5F59'));
    expect(String(result)).toBe('hsla(120, 100%, 66.66666667%, 0.6)');
  });
});
