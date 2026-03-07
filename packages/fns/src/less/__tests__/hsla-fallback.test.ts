import { describe, it, expect, vi } from 'vitest';
import { Color, ColorFormat } from '@jesscss/core';

describe('hsla() fallback branch', () => {
  it('falls back to calling hsl directly when hsl._internal is missing', async () => {
    vi.resetModules();

    let mockHsl = vi.fn(async () => new Color({
      hsl: [300, 1, 0.5],
      alpha: 0.25
    }, { format: ColorFormat.HSL }));

    try {
      vi.doMock('../hsl.js', async () => {
        const actual = await vi.importActual<typeof import('../hsl.js')>('../hsl.js');
        const wrapped = Object.assign(mockHsl, { options: (actual.default as any).options });
        return { default: wrapped };
      });

      const { default: hsla } = await import('../hsla.js');
      const hslaInternal = (hsla as unknown as {
        _internal: (this: {
          context?: unknown;
          args: () => Promise<unknown[]>;
          rawArgs: unknown[];
        }, ...args: number[]) => Promise<Color>;
      })._internal;
      const result = await hslaInternal.call(
        { context: undefined, args: async () => [], rawArgs: [] },
        300,
        1,
        0.5,
        0.25
      );

      expect(mockHsl).toHaveBeenCalledTimes(1);
      expect(result.hsl[0]).toBeCloseTo(300);
      expect(result.alpha).toBe(0.25);
    } finally {
      vi.doUnmock('../hsl.js');
      vi.resetModules();
    }
  });
});
