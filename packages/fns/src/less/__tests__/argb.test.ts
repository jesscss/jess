import { describe, it, expect } from 'vitest';
import { Color } from '@jesscss/core';
import argb from '../argb.js';

describe('argb()', () => {
  it('returns ARGB hex with alpha prefixed', () => {
    const color = new Color({
      rgb: [255, 0, 0],
      alpha: 0.5
    });
    const result = argb(color);
    expect(result).toBeInstanceOf(Color);
    expect(result.node).toBe('#80ff0000');
  });
});
