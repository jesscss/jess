import { describe, it, expect } from 'vitest';
import { Color, ColorFormat, Context, Dimension, Num, callWithContext } from '@jesscss/core';
import hsv from '../hsv.js';
import hsl from '../hsl.js';
import hsva from '../hsva.js';
import hsla from '../hsla.js';

type InternalHolder = {
  _internal?: unknown;
};

type HslaInternal = (this: {
  context?: Context;
  args: () => Promise<unknown[]>;
  rawArgs: unknown[];
}, ...args: number[]) => Promise<Color>;

function expectColor(value: unknown): Color {
  expect(value).toBeInstanceOf(Color);
  if (!(value instanceof Color)) {
    throw new Error('Expected Color instance');
  }
  return value;
}

function expectInternalHolder(value: unknown): InternalHolder {
  if ((typeof value !== 'function' && (typeof value !== 'object' || value === null)) || !('_internal' in value)) {
    throw new Error('Expected function/object with _internal');
  }
  return value;
}

function expectHslaInternal(value: unknown): HslaInternal {
  if (typeof value !== 'function') {
    throw new Error('Expected hsla internal function');
  }
  return value;
}

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
    expect(expectColor(withContext).alpha).toBe(0.75);
  });

  it('hsla accepts unitless numeric alpha nodes for color overloads', async () => {
    const result = await callWithContext(
      new Context(),
      hsla,
      new Color('#5F59'),
      new Num(0.5)
    );

    expect(expectColor(result).toTrimmedString()).toBe('hsla(120, 100%, 66.66666667%, 0.5)');
  });

  it('hsla falls back to hsl call when internal is unavailable', async () => {
    const hslInternalHolder = expectInternalHolder(hsl);
    const originalInternal = hslInternalHolder._internal;
    try {
      hslInternalHolder._internal = undefined;
      const fallback = await hsla(
        new Dimension({ number: 300, unit: 'deg' }),
        new Dimension({ number: 100, unit: '%' }),
        new Dimension({ number: 50, unit: '%' }),
        new Dimension({ number: 40, unit: '%' })
      );
      const fallbackColor = expectColor(fallback);
      expect(fallbackColor.alpha).toBeCloseTo(0.4);
      expect(fallbackColor.options.format).toBe(ColorFormat.HSL);
    } finally {
      hslInternalHolder._internal = originalInternal;
    }
  });

  it('hsla internal direct-call path works without context', async () => {
    const hslaInternal = expectHslaInternal(expectInternalHolder(hsla)._internal);

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
