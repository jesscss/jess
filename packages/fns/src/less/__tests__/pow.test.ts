import { describe, it, expect } from 'vitest';
import { makeDimension } from '@jesscss/core/value';
import { pow } from '../pow.js';

describe('pow()', () => {
  it('returns exponent result and preserves first unit', () => {
    const result = pow(
      makeDimension(3, 'rem'),
      makeDimension(2)
    );
    expect(result.number).toBe(9);
    expect(result.unit).toBe('rem');
  });
});
