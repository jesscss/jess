import { describe, it, expect } from 'vitest';
import { Color, ColorFormat, Context, Dimension, callWithContext } from '@jesscss/core';
import hsv from '../hsv.js';
import hsl from '../hsl.js';
import hsva from '../hsva.js';
import hsla from '../hsla.js';

describe('hsv/hsva/hsla()', () => {
  it('hsva converts hsv+alpha to RGBA color', () => {
    const result = hsva(
      new Dimension({ number: 0, unit: 'deg' }),
      new Dimension({ number: 100, unit: '%' }),
      new Dimension({ number: 100, unit: '%' }),
      new Dimension({ number: 50, unit: '%' })
    );
    expect(result).toBeInstanceOf(Color);
    expect(result.rgb).toEqual([255, 0, 0]);
    expect(result.alpha).toBe(0.5);
    expect(result.options.format).toBe(ColorFormat.RGB);
  });

  it('hsv delegates through hsva and sets output format', () => {
    const result = hsv(
      new Dimension({ number: 120, unit: 'deg' }),
      new Dimension({ number: 100, unit: '%' }),
      new Dimension({ number: 100, unit: '%' })
    );
    expect(result).toBeInstanceOf(Color);
    expect(result.rgb).toEqual([0, 255, 0]);
    expect(result.options.format).toBe(ColorFormat.HSL);
  });

  it('hsla works both direct and callWithContext paths', async () => {
    const direct = await hsla(
      new Dimension({ number: 240, unit: 'deg' }),
      new Dimension({ number: 100, unit: '%' }),
      new Dimension({ number: 50, unit: '%' }),
      new Dimension({ number: 25, unit: '%' })
    );
    expect(direct).toBeInstanceOf(Color);
    expect(direct.alpha).toBe(0.25);

    const withContext = await callWithContext(
      new Context(),
      hsla,
      new Dimension({ number: 60, unit: 'deg' }),
      new Dimension({ number: 100, unit: '%' }),
      new Dimension({ number: 50, unit: '%' }),
      new Dimension({ number: 75, unit: '%' })
    );
    expect(withContext).toBeInstanceOf(Color);
    expect((withContext as Color).alpha).toBe(0.75);
  });

  it('hsla falls back to hsl call when internal is unavailable', async () => {
    const originalInternal = (hsl as unknown as { _internal?: unknown })._internal;
    try {
      (hsl as unknown as { _internal?: unknown })._internal = undefined;
      const fallback = await hsla(
        new Dimension({ number: 300, unit: 'deg' }),
        new Dimension({ number: 100, unit: '%' }),
        new Dimension({ number: 50, unit: '%' }),
        new Dimension({ number: 40, unit: '%' })
      );
      expect(fallback).toBeInstanceOf(Color);
      expect((fallback as Color).alpha).toBeCloseTo(0.4);
      expect((fallback as Color).options.format).toBe(ColorFormat.HSL);
    } finally {
      (hsl as unknown as { _internal?: unknown })._internal = originalInternal;
    }
  });

  it('hsla internal direct-call path works without context', async () => {
    const hslaInternal = (hsla as unknown as {
      _internal: (this: {
        context?: Context;
        args: () => Promise<unknown[]>;
        rawArgs: unknown[];
      }, ...args: number[]) => Promise<Color>;
    })._internal;

    const result = await hslaInternal.call(
      { context: undefined, args: async () => [], rawArgs: [] },
      180,
      1,
      0.5,
      0.2
    );

    expect(result).toBeInstanceOf(Color);
    expect(result.options.format).toBe(ColorFormat.HSL);
    expect(result.alpha).toBeCloseTo(0.2);
  });
});
