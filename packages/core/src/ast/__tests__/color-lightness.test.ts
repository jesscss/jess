import { describe, expect, it } from 'vitest';
import { HEX, HSL } from '../color.js';
import type { Color } from '../value-eval.js';
import { colorHslClamped, colorLightness, makeColorHsl, makeColorRgb } from '../value-factory.js';

/** `colorLightness` is the `l` of `colorHslClamped`, to the bit, without the hue and saturation. */
describe('colorLightness', () => {
  it('reads rgb colours across the cube, out of range, and carried hsl as colorHslClamped does', () => {
    const colors: Color[] = [];
    for (let r = 0; r < 256; r += 3) {
      for (let g = 0; g < 256; g += 5) {
        for (let b = 0; b < 256; b += 7) {
          colors.push(makeColorRgb([r, g, b], 1, HEX));
        }
      }
    }
    for (const rgb of [[-20, 300, 12.5], [255.5, -0.25, 128], [1e-300, 0, 0], [NaN, 0, 0]] as const) {
      colors.push(makeColorRgb([...rgb], 1, HEX));
    }
    for (const [h, s, l] of [[120, 0.5, 0.4], [-30, 1.2, 1.1], [400, 0.3, -0.2], [0, 0, 1 / 3]] as const) {
      colors.push(makeColorHsl([h, s, l], 1, HSL));
    }
    const differ = colors.filter(c => !Object.is(colorLightness(c), colorHslClamped(c)[2]));
    expect(differ).toEqual([]);
  });
});
