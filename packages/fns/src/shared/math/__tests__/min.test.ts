import { describe, it, expect } from 'vitest';
import { Dimension } from '@jesscss/core';
import sharedMin from '../min.js';

describe('shared min()', () => {
  it('returns the minimum value node', () => {
    const a = new Dimension({ number: 10, unit: 'px' });
    const b = new Dimension({ number: 2, unit: 'px' });
    const c = new Dimension({ number: 7, unit: 'px' });
    expect(sharedMin(a, b, c)).toBe(b);
  });
});
