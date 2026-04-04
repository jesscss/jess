import { describe, it, expect } from 'vitest';
import { Dimension } from '@jesscss/core';
import sharedRound from '../round.js';

describe('shared round()', () => {
  it('rounds with precision', () => {
    const result = sharedRound(new Dimension({ number: 2.345, unit: 'px' }), 2);
    expect(result.number).toBe(2.35);
    expect(result.unit).toBe('px');
  });
});
