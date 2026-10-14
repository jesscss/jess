import { describe, it, expect } from 'vitest';
import { invoke, node } from '../../__tests__/harness.js';
import { makeDimension, makeKeyword, makeQuoted } from '@jesscss/core';
import { unit } from '../unit.js';

describe('unit()', () => {
  it('removes unit when no second argument is given', () => {
    const result = node(invoke(unit, makeDimension(42, 'px')), 'Dimension');
    expect(result.number).toBe(42);
    expect(result.unit).toBe('');
  });

  it('sets unit from Any keyword and Quoted values', () => {
    const fromAny = node(invoke(unit, makeDimension(5, 'px'), makeKeyword('em')), 'Dimension');
    const fromQuoted = node(invoke(unit, makeDimension(7, 'px'), makeQuoted('ch', '"', false)), 'Dimension');
    expect(fromAny.number).toBe(5);
    expect(fromAny.unit).toBe('em');
    expect(fromQuoted.number).toBe(7);
    expect(fromQuoted.unit).toBe('ch');
  });
});
