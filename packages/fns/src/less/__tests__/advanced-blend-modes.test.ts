import { describe, it, expect } from 'vitest';
import { Color } from '@jesscss/core';
import { makeColorRgb, RGB } from '@jesscss/core/value';
import { builtinLessFns } from '../../builtins/index.js';
import { overlay as builtinOverlay } from '../../builtins/overlay.js';
import overlay, { overlayBase } from '../overlay.js';
import softlight, { softlightBase } from '../softlight.js';
import hardlight, { hardLightBase } from '../hardlight.js';

describe('advanced blend modes', () => {
  it('overlayBase covers multiply and screen branches', () => {
    expect(overlayBase(0.2, 0.4)).toBeCloseTo(0.16, 8);
    expect(overlayBase(0.7, 0.4)).toBeCloseTo(0.64, 8);
  });

  it('softlightBase covers low and high source branches', () => {
    expect(softlightBase(0.4, 0.2)).toBeCloseTo(0.256, 8);
    expect(softlightBase(0.4, 0.8)).toBeCloseTo(0.5394733192, 8);
    expect(softlightBase(0.2, 0.8)).toBeCloseTo(0.3488, 8);
  });

  it('hardLightBase delegates to overlay with swapped args', () => {
    const cb = 0.3;
    const cs = 0.8;
    expect(hardLightBase(cb, cs)).toBeCloseTo(overlayBase(cs, cb), 10);
  });

  it('blend functions produce color outputs', () => {
    const color1 = makeColorRgb([30, 120, 220], 1, RGB);
    const color2 = makeColorRgb([220, 80, 40], 1, RGB);
    const legacyColor1 = new Color({ rgb: [30, 120, 220], alpha: 1 });
    const legacyColor2 = new Color({ rgb: [220, 80, 40], alpha: 1 });

    expect(overlay(color1, color2)).toMatchObject({ type: 'Color' });
    expect(softlight(legacyColor1, legacyColor2)).toBeInstanceOf(Color);
    expect(hardlight(legacyColor1, legacyColor2)).toBeInstanceOf(Color);
  });

  it('uses the canonical overlay implementation registered for Less', () => {
    expect(overlay).toBe(builtinOverlay);
    expect(builtinLessFns.find(fn => fn.name === 'overlay')).toBe(builtinOverlay);
  });
});
