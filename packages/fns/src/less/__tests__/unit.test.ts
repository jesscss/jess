import { describe, it, expect } from 'vitest';
import { Any, Dimension, Quoted } from '@jesscss/core';
import unit from '../unit.js';

describe('unit()', () => {
  it('removes unit when no second argument is given', () => {
    const result = unit(new Dimension({ number: 42, unit: 'px' }));
    expect(result.data.number).toBe(42);
    expect(result.data.unit).toBeUndefined();
  });

  it('sets unit from Any keyword and Quoted values', () => {
    const fromAny = unit(
      new Dimension({ number: 5, unit: 'px' }),
      new Any('em', { role: 'keyword' })
    );
    const fromQuoted = unit(
      new Dimension({ number: 7, unit: 'px' }),
      new Quoted('ch')
    );
    expect(fromAny.data).toEqual({ number: 5, unit: 'em' });
    expect(fromQuoted.data).toEqual({ number: 7, unit: 'ch' });
  });
});
