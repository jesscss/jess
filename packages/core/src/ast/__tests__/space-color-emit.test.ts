import { describe, expect, it } from 'vitest';
import { HEX } from '../color.js';
import { emitCompressed } from '../compress.js';
import { makeColorInSpace } from '../value-factory.js';
import type { Color } from '../value-eval.js';

/*
 * How a colour in a CSS Color 4 space is written (ledger V41, OPEN), pretty and
 * compressed alike: its own space's function, `none` for a missing channel, the
 * alpha only when it is not 1, and a lab-family lightness out of range as a mix
 * in that space, which its own function would clamp.
 */
const color = (space: string, channels: NonNullable<Color['channels']>, rgb: readonly [number, number, number] = [0, 0, 0]): Color =>
  makeColorInSpace(space, channels, rgb, HEX);

describe('a colour in a CSS Color 4 space', () => {
  it.each([
    ['lab', [50, 10, -20, 1], 'lab(50% 10 -20)'],
    ['oklab', [0.5, 0.1, -0.05, 1], 'oklab(50% 0.1 -0.05)'],
    ['lch', [50, 30, 120, 0.5], 'lch(50% 30 120deg / 0.5)'],
    ['oklch', [null, 0.1, null, null], 'oklch(none 0.1 none / none)'],
    ['display-p3', [1, 0, 0, 1], 'color(display-p3 1 0 0)'],
    ['xyz', [0.2, null, 0.4, 0.25], 'color(xyz 0.2 none 0.4 / 0.25)']
  ] as const)('%s writes its own function', (space, channels, css) => {
    const c = color(space, channels);
    expect(c.bytes).toBe(css);
    expect(emitCompressed(c)).toBe(css.replace(/(?<![\d.])0\./gu, '.'));
  });

  it('writes a lightness out of range as its XYZ mixed in its own space', () => {
    const c = color('lab', [120, 0, 0, 1], [255, 255, 255]);
    expect(c.bytes).toBe('color-mix(in lab, color(xyz 0.950455927 1 1.0890577508) 100%, black)');
    expect(emitCompressed(c)).toBe('color-mix(in lab,color(xyz .950455927 1 1.0890577508) 100%,black)');
  });

  it('keeps a lightness at the end of its range within fuzzy equality', () => {
    expect(color('oklab', [1 + 1e-12, 0, 0, 1]).bytes).toMatch(/^oklab\(/u);
    expect(color('lab', [-1e-12, 0, 0, 1]).bytes).toMatch(/^lab\(/u);
  });
});
