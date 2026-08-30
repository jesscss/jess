import { describe, it, expect } from 'vitest';
import { Color, ColorFormat, Dimension } from '../index.js';

describe('named CSS colors in color math', () => {
  it('resolves a named-color keyword node to rgb', () => {
    const c = new Color({ node: 'yellow' });
    expect(c.rgb).toEqual([255, 255, 0]);
  });

  it('resolves transparent to rgba(0,0,0,0)', () => {
    const c = new Color({ node: 'transparent' });
    expect(c.rgb).toEqual([0, 0, 0]);
    expect(c.alpha).toBe(0);
  });

  it('operates a named color against a hex color', () => {
    const yellow = new Color({ node: 'yellow' });
    const dark = new Color('#070707');
    const out = yellow.operate(dark, '-');
    expect(out.rgb).toEqual([248, 248, 0]);
  });

  it('operates a named color against a unitless dimension', () => {
    const white = new Color({ node: 'white' }, { format: ColorFormat.RGB });
    const eight = new Dimension({ number: 8, unit: '' });
    const out = white.operate(eight, '-');
    expect(out.rgb).toEqual([247, 247, 247]);
  });
});
