import { describe, expect, it } from 'vitest';
import { makeDimension } from '@jesscss/core';
import sharedAbs from '../abs.js';

describe('shared abs()', () => {
  it('returns a canonical dimension while preserving the unit', () => {
    expect(sharedAbs(makeDimension(-3, 'px'))).toMatchObject({
      type: 'Dimension',
      number: 3,
      unit: 'px'
    });
  });
});
