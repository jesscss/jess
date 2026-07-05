import { describe, it, expect } from 'vitest';
import { Color, ColorFormat, Context, Dimension, List, RuntimeFunction } from '@jesscss/core';
import hsl from '../hsl.js';
import { hslImplementation } from '../hsl.js';

describe('hsl() branch coverage', () => {
  it('canonicalizes fully clamped HSL output through RGB before serialization', async () => {
    const result = await hsl(
      new Dimension({ number: 380, unit: '' }),
      new Dimension({ number: 150, unit: '%' }),
      new Dimension({ number: 150, unit: '%' })
    );

    expect(result).toBeInstanceOf(Color);
    expect(result.options.format).toBe(ColorFormat.HSL);
    expect(result.toTrimmedString()).toBe('hsl(0, 0%, 100%)');
  });

  it('preserves hue unit and supports modern syntax option', async () => {
    const result = await hsl(
      new Dimension({ number: 180, unit: 'deg' }),
      new Dimension({ number: 50, unit: '%' }),
      new Dimension({ number: 50, unit: '%' })
    );
    expect(result).toBeInstanceOf(Color);
    expect(result.options.format).toBe(ColorFormat.HSL);

    const internalResult = await (hslImplementation as RuntimeFunction).call(
      {
        caller: { options: { modernSyntax: true } },
        context: new Context(),
        rawArgs: new List([new Dimension({ number: 90, unit: 'deg' })]),
        args: async () => []
      },
      90,
      0.5,
      0.5
    );
    expect(internalResult.options.modernSyntax).toBe(true);
  });

  it('throws for invalid internal argument signatures', async () => {
    await expect(
      (hslImplementation as RuntimeFunction).call(
        {
          context: new Context(),
          rawArgs: new List([]),
          args: async () => []
        }
      )
    ).rejects.toThrow('Invalid arguments for hsl function');
  });
});
