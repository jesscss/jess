import { describe, it, expect } from 'vitest';
import { Dimension } from '@jesscss/core';
import pow from '../pow.js';

describe('pow()', () => {
  it('returns exponent result and preserves first unit', () => {
    const result = pow(
      new Dimension({ number: 3, unit: 'rem' }),
      new Dimension({ number: 2, unit: '' })
    );
    expect(result.number).toBe(9);
    expect(result.unit).toBe('rem');
  });
});
