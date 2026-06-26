/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import { describe, it, expect } from 'vitest';
import { Color, ColorFormat, Context, Dimension, List, callWithContext, RuntimeFunction } from '@jesscss/core';
import rgb from '../rgb.js';
import { rgbImplementation } from '../rgb.js';
import rgba from '../rgba.js';

describe('rgb()/rgba() branch coverage', () => {
  it('throws on invalid rgb signatures', async () => {
    expect(() => rgb()).toThrow();
    expect(() => rgb(new Dimension({ number: 1 }) as never)).toThrow();
    await expect(
      (rgbImplementation as RuntimeFunction).call(
        {
          context: new Context(),
          rawArgs: new List([]),
          args: async () => []
        },
        Number.NaN
      )
    ).rejects.toThrow('Invalid arguments for rgb function');
  });

  it('propagates modern syntax from caller options', async () => {
    const result = await (rgbImplementation as RuntimeFunction).call(
      {
        caller: { options: { modernSyntax: true } },
        context: new Context(),
        rawArgs: new List([]),
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

  it('supports callWithContext through the rgba alias', async () => {
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
  });

  it('preserves percent raw channels through the shared rgb implementation', async () => {
    const rawArgs = new List([
      new Dimension({ number: 10, unit: '%' }),
      new Dimension({ number: 20, unit: '%' }),
      new Dimension({ number: 30, unit: '%' })
    ]);
    const result = await (rgbImplementation as RuntimeFunction).call(
      {
        context: new Context(),
        rawArgs,
        args: async () => []
      },
      25.5,
      51,
      76.5
    );
    const raw = result._rgbChannels!;

    expect(raw[0]).toEqual([10, '%']);
    expect(raw[1]).toEqual([20, '%']);
    expect(raw[2]).toEqual([30, '%']);
  });

  it('rgba direct-call path works without context', async () => {
    const result = await rgba(new Dimension({ number: 1 }), new Dimension({ number: 2 }), new Dimension({ number: 3 }), new Dimension({ number: 0.4 })) as Color;

    expect(result).toBeInstanceOf(Color);
    expect(result.options.format).toBe(ColorFormat.RGB);
    expect(result.alpha).toBeCloseTo(0.4);
  });
});
