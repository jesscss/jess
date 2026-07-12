import { describe, it, expect } from 'vitest';
import { Color, ColorFormat, Context, Dimension } from '@jesscss/core';
import hsl from '../hsl.js';

type HslInternal = {
  _internal: (this: {
    caller?: { options?: { modernSyntax?: boolean } };
    context?: Context;
    rawArgs?: unknown;
    args?: () => Promise<unknown[]>;
  }, ...args: unknown[]) => Promise<Color>;
};

describe('hsl() branch coverage', () => {
  it('preserves hue unit and supports modern syntax option', async () => {
    const result = await hsl(
      new Dimension({ number: 180, unit: 'deg' }),
      new Dimension({ number: 50, unit: '%' }),
      new Dimension({ number: 50, unit: '%' })
    );
    expect(result).toBeInstanceOf(Color);
    expect(result.options.format).toBe(ColorFormat.HSL);

    const hslInternal = (hsl as unknown as HslInternal)._internal;
    const internalResult = await hslInternal.call(
      {
        caller: { options: { modernSyntax: true } },
        context: new Context(),
        rawArgs: [new Dimension({ number: 90, unit: 'deg' })],
        args: async () => []
      },
      90,
      0.5,
      0.5
    );
    expect(internalResult.options.modernSyntax).toBe(true);
  });

  it('throws for invalid internal argument signatures', async () => {
    const hslInternal = (hsl as unknown as HslInternal)._internal;
    await expect(
      hslInternal.call(
        {
          context: new Context(),
          rawArgs: [],
          args: async () => []
        }
      )
    ).rejects.toThrow('Invalid arguments for hsl function');
  });
});
