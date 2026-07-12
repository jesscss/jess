import { describe, it, expect } from 'vitest';
import { Dimension } from '@jesscss/core';
import sharedMax from '../max.js';

describe('shared max()', () => {
  it('returns the maximum value node', () => {
    const a = new Dimension({ number: 10, unit: 'px' });
    const b = new Dimension({ number: 2, unit: 'px' });
    const c = new Dimension({ number: 7, unit: 'px' });
    expect(sharedMax(a, b, c)).toBe(a);
  });
});
