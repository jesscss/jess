import { describe, it, expect, vi } from 'vitest';
import { Color, ColorFormat } from '@jesscss/core';

describe('rgba() fallback branch', () => {
  it('falls back to calling rgb directly when rgb._internal is missing', async () => {
    vi.resetModules();

    let mockRgb = vi.fn(async () => new Color({
      rgb: [12, 34, 56],
      alpha: 0.4
    }, { format: ColorFormat.RGB }));

    try {
      vi.doMock('../rgb.js', async () => {
        const actual = await vi.importActual<typeof import('../rgb.js')>('../rgb.js');
        const wrapped = Object.assign(mockRgb, { options: (actual.default as any).options });
        return { default: wrapped };
      });

      const { default: rgba } = await import('../rgba.js');
      const rgbaInternal = (rgba as unknown as {
        _internal: (this: {
          context?: unknown;
          args: () => Promise<unknown[]>;
          rawArgs: unknown[];
        }, ...args: number[]) => Promise<Color>;
      })._internal;
      const result = await rgbaInternal.call(
        { context: undefined, args: async () => [], rawArgs: [] },
        1,
        2,
        3,
        0.5
      );

      expect(mockRgb).toHaveBeenCalledTimes(1);
      expect(result.rgb).toEqual([12, 34, 56]);
      expect(result.alpha).toBe(0.4);
    } finally {
      vi.doUnmock('../rgb.js');
      vi.resetModules();
    }
  });
});
