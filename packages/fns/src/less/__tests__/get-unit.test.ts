import { describe, it, expect } from 'vitest';
import { invoke } from '../../__tests__/harness.js';
import { makeDimension } from '@jesscss/core';
import { getUnit } from '../get-unit.js';

describe('get-unit()', () => {
  it('returns a keyword Any node containing the unit', () => {
    const result = invoke(getUnit, makeDimension(12, 'vh'));
    expect(result).toMatchObject({ type: 'Keyword', text: 'vh', bytes: 'vh' });
  });

  it('returns empty unit for unitless values', () => {
    const result = invoke(getUnit, makeDimension(12, ''));
    expect(result).toMatchObject({ type: 'Keyword', text: '', bytes: '' });
  });
});
