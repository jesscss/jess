import { describe, it, expect } from 'vitest';
import { Color, ColorFormat, Context, Dimension, callWithContext } from '@jesscss/core';
import rgb from '../rgb.js';
import rgba from '../rgba.js';

type RgbInternal = {
  _internal: (this: {
    caller?: { options?: { modernSyntax?: boolean } };
    context?: Context;
    rawArgs?: unknown;
    args?: () => Promise<unknown[]>;
  }, ...args: number[]) => Promise<Color>;
};

describe('rgb()/rgba() branch coverage', () => {
  it('throws on invalid rgb signatures', async () => {
    const rgbInternal = (rgb as unknown as RgbInternal)._internal;
    expect(() => rgb()).toThrow();
    expect(() => rgb(new Dimension({ number: 1 }) as never)).toThrow();
    await expect(
      rgbInternal.call(
        {
          context: new Context(),
          rawArgs: [],
          args: async () => []
        },
        Number.NaN
      )
    ).rejects.toThrow('Invalid arguments for rgb function');
  });

  it('propagates modern syntax from caller options', async () => {
    const rgbInternal = (rgb as unknown as RgbInternal)._internal;
    const result = await rgbInternal.call(
      {
        caller: { options: { modernSyntax: true } },
        context: new Context(),
        rawArgs: [],
        args: async () => []
      },
      255,
      0,
      0
    );

    expect(result.options.format).toBe(ColorFormat.RGB);
    expect(result.options.modernSyntax).toBe(true);
  });

  it('uses rgb implementation through rgba alias', async () => {
    const result = await rgba(
      new Dimension({ number: 255 }),
      new Dimension({ number: 0 }),
      new Dimension({ number: 0 }),
      new Dimension({ number: 50, unit: '%' })
    ) as Color;

    expect(result).toBeInstanceOf(Color);
    expect(result.rgb).toEqual([255, 0, 0]);
    expect(result.alpha).toBeCloseTo(0.5);
  });

  it('supports callWithContext and fallback path when rgb internal is unavailable', async () => {
    const withContext = await callWithContext(
      new Context(),
      rgba,
      new Dimension({ number: 0 }),
      new Dimension({ number: 255 }),
      new Dimension({ number: 0 }),
      new Dimension({ number: 25, unit: '%' })
    ) as Color;
    expect(withContext.rgb).toEqual([0, 255, 0]);
    expect(withContext.alpha).toBeCloseTo(0.25);

    const originalInternal = (rgb as unknown as { _internal?: unknown })._internal;
    try {
      (rgb as unknown as { _internal?: unknown })._internal = undefined;
      const fallback = await rgba(
        new Dimension({ number: 0 }),
        new Dimension({ number: 0 }),
        new Dimension({ number: 255 }),
        new Dimension({ number: 50, unit: '%' })
      ) as Color;
      expect(fallback.rgb).toEqual([0, 0, 255]);
      expect(fallback.alpha).toBeCloseTo(0.5);
    } finally {
      (rgb as unknown as { _internal?: unknown })._internal = originalInternal;
    }
  });
});
