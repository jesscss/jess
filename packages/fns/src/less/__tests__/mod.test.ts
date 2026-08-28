import { describe, it, expect } from 'vitest';
import { makeDimension } from '@jesscss/core';
import { mod } from '../mod.js';

describe('mod()', () => {
  it('returns modulo result and preserves first unit', () => {
    const result = mod(
      makeDimension(10, 'px'),
      makeDimension(4, 'em')
    );
    expect(result.number).toBe(2);
    expect(result.unit).toBe('px');
  });
});
