import { describe, it, expect } from 'vitest';
import { makeColorRgb, RGB } from '@jesscss/core';
import { lessFns } from '../registry.js';
import { overlay, overlayBase } from '../overlay.js';
import { softlight, softlightBase } from '../softlight.js';
import { hardlight, hardlightBase } from '../hardlight.js';

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

  it('hardlightBase delegates to overlay with swapped args', () => {
    const cb = 0.3;
    const cs = 0.8;
    expect(hardlightBase(cb, cs)).toBeCloseTo(overlayBase(cs, cb), 10);
  });

  it('blend functions produce color outputs', () => {
    const color1 = makeColorRgb([30, 120, 220], 1, RGB);
    const color2 = makeColorRgb([220, 80, 40], 1, RGB);

    expect(overlay(color1, color2)).toMatchObject({ type: 'Color' });
    expect(softlight(color1, color2)).toMatchObject({ type: 'Color' });
    expect(hardlight(color1, color2)).toMatchObject({ type: 'Color' });
  });

  it('uses the canonical overlay implementation registered for Less', () => {
    expect(lessFns.find(fn => fn.name === 'overlay')).toBe(overlay);
    expect(lessFns.find(fn => fn.name === 'softlight')).toBe(softlight);
    expect(lessFns.find(fn => fn.name === 'hardlight')).toBe(hardlight);
  });
});
