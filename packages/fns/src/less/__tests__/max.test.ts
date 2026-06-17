import { describe, it, expect } from 'vitest';
import { Any, Context, Dimension, List, callWithContext } from '@jesscss/core';
import max from '../max.js';

function expectDimension(value: unknown): Dimension {
  expect(value).toBeInstanceOf(Dimension);
  if (!(value instanceof Dimension)) {
    throw new TypeError('Expected Dimension');
  }
  return value;
}

function expectAny(value: unknown): Any {
  expect(value).toBeInstanceOf(Any);
  if (!(value instanceof Any)) {
    throw new TypeError('Expected Any');
  }
  return value;
}

describe('max()', () => {
  it('picks max for same-unit values', async () => {
    const result = await callWithContext(
      new Context(),
      max,
      new Dimension({ number: 2, unit: 'px' }),
      new Dimension({ number: 10, unit: 'px' }),
      new Dimension({ number: 6, unit: 'px' })
    );
    expect(expectDimension(result).number).toBe(10);
  });

  it('returns serialized Any when values cannot be unified to one unit', async () => {
    const result = await callWithContext(
      new Context(),
      max,
      new Dimension({ number: 10, unit: 'px' }),
      new Dimension({ number: 2, unit: 's' })
    );
    expect(expectAny(result).valueOf()).toContain('max(');
  });

  it('flattens list args and throws in strict mode for incompatible units', async () => {
    const listArg = new List([new Dimension({ number: 1, unit: 'px' }), new Dimension({ number: 5, unit: 'px' })]);
    const fromList = await callWithContext(new Context(), max, listArg);
    expect(fromList.number).toBe(5);

    await expect(() => callWithContext(
      new Context({ unitMode: 'strict' }),
      max,
      new Dimension({ number: 1, unit: 'px' }),
      new Dimension({ number: 1, unit: 's' })
    )).rejects.toThrow('incompatible types');
  });

  it('uses compressed serialization and rejects non-dimension values', async () => {
    const serialized = expectAny(await callWithContext(
      new Context({ compress: true }),
      max,
      new Dimension({ number: 10, unit: 'px' }),
      new Dimension({ number: 2, unit: 's' })
    ));
    expect(serialized.valueOf()).toBe('max(10px, 2s)');

    await expect(() => callWithContext(
      new Context(),
      max,
      new Any('oops', { role: 'keyword' })
    )).rejects.toThrow('incompatible types');
  });

  it('handles unitless and unknown-unit dimensions in loose mode', async () => {
    const unitless = expectDimension(await callWithContext(
      new Context(),
      max,
      new Dimension({ number: 1 }),
      new Dimension({ number: 3 })
    ));
    expect(unitless.number).toBe(3);
    expect(unitless.unit).toBeUndefined();

    const unknownUnits = expectAny(await callWithContext(
      new Context(),
      max,
      new Dimension({ number: 1, unit: 'furlong' }),
      new Dimension({ number: 2, unit: 'league' })
    ));
    expect(unknownUnits.valueOf()).toContain('max(');
  });
});
