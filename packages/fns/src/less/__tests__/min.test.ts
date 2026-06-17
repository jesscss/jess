import { describe, it, expect } from 'vitest';
import { Any, Context, Dimension, List, callWithContext } from '@jesscss/core';
import min from '../min.js';

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

describe('min()', () => {
  it('picks min for same-unit values', async () => {
    const result = await callWithContext(
      new Context(),
      min,
      new Dimension({ number: 2, unit: 'px' }),
      new Dimension({ number: 10, unit: 'px' }),
      new Dimension({ number: 6, unit: 'px' })
    );
    expect(expectDimension(result).number).toBe(2);
  });

  it('returns serialized Any when values cannot be unified to one unit', async () => {
    const result = await callWithContext(
      new Context(),
      min,
      new Dimension({ number: 10, unit: 'px' }),
      new Dimension({ number: 2, unit: 's' })
    );
    expect(expectAny(result).valueOf()).toContain('min(');
  });

  it('flattens list args and throws in strict mode for incompatible units', async () => {
    const listArg = new List([new Dimension({ number: 1, unit: 'px' }), new Dimension({ number: 5, unit: 'px' })]);
    const fromList = await callWithContext(new Context(), min, listArg);
    expect(fromList.number).toBe(1);

    await expect(() => callWithContext(
      new Context({ unitMode: 'strict' }),
      min,
      new Dimension({ number: 1, unit: 'px' }),
      new Dimension({ number: 1, unit: 's' })
    )).rejects.toThrow('incompatible types');
  });

  it('uses compressed serialization and rejects non-dimension values', async () => {
    const serialized = expectAny(await callWithContext(
      new Context({ compress: true }),
      min,
      new Dimension({ number: 10, unit: 'px' }),
      new Dimension({ number: 2, unit: 's' })
    ));
    expect(serialized.valueOf()).toBe('min(10px, 2s)');

    await expect(() => callWithContext(
      new Context(),
      min,
      new Any('oops', { role: 'keyword' })
    )).rejects.toThrow('incompatible types');
  });

  it('updates selected min and handles unitless/unknown-unit dimensions', async () => {
    const updatedMin = expectDimension(await callWithContext(
      new Context(),
      min,
      new Dimension({ number: 10, unit: 'px' }),
      new Dimension({ number: 2, unit: 'px' })
    ));
    expect(updatedMin.number).toBe(2);

    const unitless = expectDimension(await callWithContext(
      new Context(),
      min,
      new Dimension({ number: 2 }),
      new Dimension({ number: 1 })
    ));
    expect(unitless.number).toBe(1);
    expect(unitless.unit).toBeUndefined();

    const unknownUnits = expectAny(await callWithContext(
      new Context(),
      min,
      new Dimension({ number: 1, unit: 'furlong' }),
      new Dimension({ number: 2, unit: 'league' })
    ));
    expect(unknownUnits.valueOf()).toContain('min(');
  });
});
