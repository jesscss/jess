import { describe, it, expect } from 'vitest';
import { makeDimension, makeKeyword, makeQuoted } from '@jesscss/core';
import { unit } from '../unit.js';

describe('unit()', () => {
  it('removes unit when no second argument is given', () => {
    const result = unit(makeDimension(42, 'px'));
    expect(result.number).toBe(42);
    expect(result.unit).toBe('');
  });

  it('sets unit from Any keyword and Quoted values', () => {
    const fromAny = unit(makeDimension(5, 'px'), makeKeyword('em'));
    const fromQuoted = unit(makeDimension(7, 'px'), makeQuoted('ch'));
    expect(fromAny.number).toBe(5);
    expect(fromAny.unit).toBe('em');
    expect(fromQuoted.number).toBe(7);
    expect(fromQuoted.unit).toBe('ch');
  });
});
