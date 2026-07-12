import { describe, it, expect } from 'vitest';
import { Dimension } from '@jesscss/core';
import getUnit from '../get-unit.js';

describe('get-unit()', () => {
  it('returns a keyword Any node containing the unit', () => {
    const result = getUnit(new Dimension({ number: 12, unit: 'vh' }));
    expect(result.valueOf()).toBe('vh');
    expect(result.role).toBe('keyword');
  });

  it('returns empty unit for unitless values', () => {
    const result = getUnit(new Dimension({ number: 12, unit: '' }));
    expect(result.valueOf()).toBe('');
  });
});
