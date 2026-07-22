import { describe, it, expect } from 'vitest';
import { emitValue, makeDimension, makeKeyword, makeList, type Dimension, type Fn, type Keyword, type ValueGroup, type ValueObj } from '@jesscss/core/value';
import max from '../max.js';

const call = (fn: Fn, unitMode: 'loose' | 'preserve' | 'strict', ...args: ValueGroup[]): ValueObj => {
  const result = fn(makeList(args, ','), { modes: { unitMode }, stringify: emitValue });
  if (result instanceof Promise) {
    throw new TypeError('Expected max() to be synchronous in this test.');
  }
  if (Array.isArray(result)) {
    throw new TypeError('Expected max() to return a scalar value.');
  }
  return result;
};

function expectDimension(value: unknown): Dimension {
  expect(value).toMatchObject({ type: 'Dimension' });
  if (value === null || typeof value !== 'object' || !('type' in value) || value.type !== 'Dimension') {
    throw new TypeError('Expected Dimension');
  }
  return value;
}

function expectAny(value: unknown): Keyword {
  expect(value).toMatchObject({ type: 'Keyword' });
  if (value === null || typeof value !== 'object' || !('type' in value) || value.type !== 'Keyword') {
    throw new TypeError('Expected Keyword');
  }
  return value;
}

describe('max()', () => {
  it('picks max for same-unit values', async () => {
    const result = call(max, 'preserve', makeDimension(2, 'px'), makeDimension(10, 'px'), makeDimension(6, 'px'));
    expect(expectDimension(result).number).toBe(10);
  });

  it('returns serialized Any when values cannot be unified to one unit', async () => {
    const result = call(max, 'preserve', makeDimension(10, 'px'), makeDimension(2, 's'));
    expect(expectAny(result).bytes).toContain('max(');
  });

  it('flattens list args and throws in strict mode for incompatible units', async () => {
    const listArg = [makeDimension(1, 'px'), makeDimension(5, 'px')];
    const fromList = call(max, 'preserve', listArg);
    expect(fromList.number).toBe(5);

    expect(() => call(max, 'strict', makeDimension(1, 'px'), makeDimension(1, 's'))).toThrow('incompatible units');
  });

  it('uses compressed serialization and rejects non-dimension values', async () => {
    const serialized = expectAny(call(max, 'preserve', makeDimension(10, 'px'), makeDimension(2, 's')));
    expect(serialized.bytes).toBe('max(10px, 2s)');

    expect(() => call(max, 'preserve', makeKeyword('oops'))).toThrow('numeric arguments');
  });

  it('handles unitless and unknown-unit dimensions in loose mode', async () => {
    const unitless = expectDimension(call(max, 'preserve', makeDimension(1), makeDimension(3)));
    expect(unitless.number).toBe(3);
    expect(unitless.unit).toBe('');

    const unknownUnits = expectAny(call(max, 'preserve', makeDimension(1, 'furlong'), makeDimension(2, 'league')));
    expect(unknownUnits.bytes).toContain('max(');
  });
});
