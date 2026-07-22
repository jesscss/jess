import { describe, it, expect } from 'vitest';
import { emitValue, makeDimension, makeKeyword, makeList, type Dimension, type Fn, type Keyword, type ValueGroup, type ValueObj } from '@jesscss/core/value';
import min from '../min.js';

const call = (fn: Fn, unitMode: 'loose' | 'preserve' | 'strict', ...args: ValueGroup[]): ValueObj => {
  const result = fn(makeList(args, ','), { modes: { unitMode }, stringify: emitValue });
  if (result instanceof Promise) {
    throw new TypeError('Expected min() to be synchronous in this test.');
  }
  if (Array.isArray(result)) {
    throw new TypeError('Expected min() to return a scalar value.');
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

describe('min()', () => {
  it('picks min for same-unit values', async () => {
    const result = call(min, 'preserve', makeDimension(2, 'px'), makeDimension(10, 'px'), makeDimension(6, 'px'));
    expect(expectDimension(result).number).toBe(2);
  });

  it('returns serialized Any when values cannot be unified to one unit', async () => {
    const result = call(min, 'preserve', makeDimension(10, 'px'), makeDimension(2, 's'));
    expect(expectAny(result).bytes).toContain('min(');
  });

  it('flattens list args and throws in strict mode for incompatible units', async () => {
    const listArg = [makeDimension(1, 'px'), makeDimension(5, 'px')];
    const fromList = call(min, 'preserve', listArg);
    expect(fromList.number).toBe(1);

    expect(() => call(min, 'strict', makeDimension(1, 'px'), makeDimension(1, 's'))).toThrow('incompatible units');
  });

  it('uses compressed serialization and rejects non-dimension values', async () => {
    const serialized = expectAny(call(min, 'preserve', makeDimension(10, 'px'), makeDimension(2, 's')));
    expect(serialized.bytes).toBe('min(10px, 2s)');

    expect(() => call(min, 'preserve', makeKeyword('oops'))).toThrow('numeric arguments');
  });

  it('updates selected min and handles unitless/unknown-unit dimensions', async () => {
    const updatedMin = expectDimension(call(min, 'preserve', makeDimension(10, 'px'), makeDimension(2, 'px')));
    expect(updatedMin.number).toBe(2);

    const unitless = expectDimension(call(min, 'preserve', makeDimension(2), makeDimension(1)));
    expect(unitless.number).toBe(1);
    expect(unitless.unit).toBe('');

    const unknownUnits = expectAny(call(min, 'preserve', makeDimension(1, 'furlong'), makeDimension(2, 'league')));
    expect(unknownUnits.bytes).toContain('min(');
  });
});
