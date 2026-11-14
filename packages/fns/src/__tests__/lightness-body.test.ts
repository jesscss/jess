import { describe, expect, it } from 'vitest';
import { HEX, HSL, makeColorHsl, makeColorRgb, type Color } from '@jesscss/core';
import { lightness } from '../less/index.js';
import { lightnessOf } from '../less/bodies.js';
import { call } from './harness.js';

/** The body a generated runtime module calls directly gives what the defined function gives, on the same checked colour (DESIGN-DECISIONS-NOTES.md, "Direct body calls"). */
describe('lightness body', () => {
  it('equals the defined function on each checked colour', () => {
    const colors: Color[] = [
      makeColorRgb([204, 0, 0], 1, HEX),
      makeColorRgb([0, 136, 255], 1, HEX),
      makeColorRgb([18, 0, 171], 0.5, HEX),
      makeColorRgb([-20, 300, 12.5], 1, HEX),
      makeColorHsl([120, 0.5, 0.4], 1, HSL),
      makeColorHsl([0, 0, 1.2], 1, HSL)
    ];
    for (const c of colors) {
      expect(lightnessOf(c)).toEqual(call(lightness, c));
    }
  });

  it('is named where the defined function says its body is exported', () => {
    expect(lightness.bodyExport).toEqual({ module: '@jesscss/fns/less/bodies', name: 'lightnessOf' });
  });
});
