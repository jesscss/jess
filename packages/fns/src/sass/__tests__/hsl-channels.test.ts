/**
 * The CROSS-DIALECT claims about the hsl channel readers.
 *
 * Per-function behaviour is covered exhaustively by the sass-spec corpus
 * (`color-sass-spec.test.ts`). What the corpus cannot state — because it only
 * knows about Sass — is how each reader RELATES to its Less namesake, and that
 * relation is the classification this port acts on. That is what this file pins.
 */
import { describe, expect, it } from 'vitest';
import { makeColorHsl, makeList, HSL } from '@jesscss/core/value';
import type { Dimension, Fn, FnCtx, ValueGroup, ValueObj } from '@jesscss/core/value';
import { isValueGroupArray } from '@jesscss/core/value';
import { hue } from '../color/hue.js';
import { saturation } from '../color/saturation.js';
import { lightness } from '../color/lightness.js';
import { opacity } from '../color/opacity.js';
import { hue as lessHue } from '../../less/hue.js';
import { saturation as lessSaturation } from '../../less/saturation.js';
import { lightness as lessLightness } from '../../less/lightness.js';

const ctx: FnCtx = {
  modes: { unitMode: 'preserve' },
  stringify: v => (isValueGroupArray(v) ? '' : v.bytes)
};

function call(fn: Fn, ...args: ValueObj[]): Dimension {
  const result = fn(makeList(args as readonly ValueGroup[], ','), ctx);
  if (result instanceof Promise || isValueGroupArray(result) || result.type !== 'Dimension') {
    throw new TypeError('Expected a Dimension result.');
  }
  return result;
}

const green = makeColorHsl([120, 0.5, 0.5], 1, HSL);
const translucent = makeColorHsl([120, 0.5, 0.5], 0.4, HSL);

describe('sass:color hsl channel readers vs Less', () => {
  it('hue() DIVERGES from Less: Sass returns degrees, Less a unitless number', () => {
    expect(call(hue, green)).toMatchObject({ number: 120, unit: 'deg' });
    expect(call(lessHue, green)).toMatchObject({ number: 120, unit: '' });
    expect(hue).not.toBe(lessHue);
  });

  it('saturation()/lightness() agree with Less numerically but stay dialect-owned', () => {
    expect(call(saturation, green)).toMatchObject({ number: 50, unit: '%' });
    expect(call(lessSaturation, green)).toMatchObject({ number: 50, unit: '%' });
    expect(call(lightness, green)).toMatchObject({ number: 50, unit: '%' });
    expect(call(lessLightness, green)).toMatchObject({ number: 50, unit: '%' });
    // Sass's are `color.saturation`/`color.lightness`, which carry a `$space`
    // parameter Less has no concept of, so they remain separate bodies even
    // while today's numbers coincide.
    expect(saturation).not.toBe(lessSaturation);
    expect(lightness).not.toBe(lessLightness);
  });

  it('opacity() reads the alpha channel', () => {
    expect(call(opacity, translucent)).toMatchObject({ number: 0.4, unit: '' });
    expect(call(opacity, green)).toMatchObject({ number: 1, unit: '' });
  });

  it('every reader carries its SASS dispatch name', () => {
    expect([hue.name, saturation.name, lightness.name, opacity.name])
      .toEqual(['hue', 'saturation', 'lightness', 'opacity']);
  });
});
