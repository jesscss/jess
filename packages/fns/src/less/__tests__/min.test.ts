import { describe, it, expect } from 'vitest';
import { Any, Context, Dimension, List, callWithContext } from '@jesscss/core';
import min from '../min.js';

describe('min()', () => {
  it('picks min for same-unit values', async () => {
    const result = await callWithContext(
      new Context(),
      min,
      new Dimension({ number: 2, unit: 'px' }),
      new Dimension({ number: 10, unit: 'px' }),
      new Dimension({ number: 6, unit: 'px' })
    );
    expect(result).toBeInstanceOf(Dimension);
    expect((result as Dimension).value.number).toBe(2);
  });

  it('returns serialized Any when values cannot be unified to one unit', async () => {
    const result = await callWithContext(
      new Context(),
      min,
      new Dimension({ number: 10, unit: 'px' }),
      new Dimension({ number: 2, unit: 's' })
    );
    expect(result).toBeInstanceOf(Any);
    expect(result.valueOf()).toContain('min(');
  });

  it('flattens list args and throws in strict mode for incompatible units', async () => {
    const listArg = new List([new Dimension({ number: 1, unit: 'px' }), new Dimension({ number: 5, unit: 'px' })]);
    const fromList = await callWithContext(new Context(), min, listArg);
    expect(fromList.value.number).toBe(1);

    await expect(() => callWithContext(
      new Context({ unitMode: 'strict' }),
      min,
      new Dimension({ number: 1, unit: 'px' }),
      new Dimension({ number: 1, unit: 's' })
    )).rejects.toThrow('incompatible types');
  });

  it('uses compressed serialization and rejects non-dimension values', async () => {
    const serialized = await callWithContext(
      new Context({ compress: true }),
      min,
      new Dimension({ number: 10, unit: 'px' }),
      new Dimension({ number: 2, unit: 's' })
    ) as Any;
    expect(serialized.valueOf()).toBe('min(10px, 2s)');

    await expect(() => callWithContext(
      new Context(),
      min,
      new Any('oops', { role: 'keyword' })
    )).rejects.toThrow('incompatible types');
  });

  it('updates selected min and handles unitless/unknown-unit dimensions', async () => {
    const updatedMin = await callWithContext(
      new Context(),
      min,
      new Dimension({ number: 10, unit: 'px' }),
      new Dimension({ number: 2, unit: 'px' })
    ) as Dimension;
    expect(updatedMin.value.number).toBe(2);

    const unitless = await callWithContext(
      new Context(),
      min,
      new Dimension({ number: 2 }),
      new Dimension({ number: 1 })
    ) as Dimension;
    expect(unitless.value.number).toBe(1);
    expect(unitless.value.unit).toBeUndefined();

    const unknownUnits = await callWithContext(
      new Context(),
      min,
      new Dimension({ number: 1, unit: 'furlong' }),
      new Dimension({ number: 2, unit: 'league' })
    ) as Any;
    expect(unknownUnits).toBeInstanceOf(Any);
    expect(unknownUnits.valueOf()).toContain('min(');
  });
});
