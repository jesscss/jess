import { describe, it, expect } from 'vitest';
import { makeColorRgb, RGB } from '@jesscss/core/value';
import { builtinLessFns } from '../../builtins/index.js';
import { argb as builtinArgb } from '../../builtins/argb.js';
import argb from '../argb.js';

describe('argb()', () => {
  it('returns ARGB hex with alpha prefixed', () => {
    const color = makeColorRgb([255, 0, 0], 0.5, RGB);
    const result = argb(color);
    expect(result).toMatchObject({ type: 'Color', bytes: '#80ff0000' });
  });

  it('uses the canonical implementation registered for Less', () => {
    expect(argb).toBe(builtinArgb);
    expect(builtinLessFns.find(fn => fn.name === 'argb')).toBe(builtinArgb);
  });
});
