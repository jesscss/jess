import { describe, it, expect } from 'vitest';
import { Dimension } from '@jesscss/core';
import mod from '../mod.js';

describe('mod()', () => {
  it('returns modulo result and preserves first unit', () => {
    const result = mod(
      new Dimension({ number: 10, unit: 'px' }),
      new Dimension({ number: 4, unit: 'em' })
    );
    expect(result.data.number).toBe(2);
    expect(result.data.unit).toBe('px');
  });
});
