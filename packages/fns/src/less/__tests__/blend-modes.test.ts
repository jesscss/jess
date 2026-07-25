import { describe, it, expect } from 'vitest';
import { makeColorRgb, RGB } from '@jesscss/core/value';
import { lessFns } from '../registry.js';
import { average } from '../average.js';
import { difference } from '../difference.js';
import { exclusion } from '../exclusion.js';
import { multiply } from '../multiply.js';
import { negation } from '../negation.js';
import { screen } from '../screen.js';

describe('less blend modes', () => {
  it('blends black and white as expected', () => {
    const blackValue = makeColorRgb([0, 0, 0], 1, RGB);
    const whiteValue = makeColorRgb([255, 255, 255], 1, RGB);
    expect(average(blackValue, whiteValue)).toMatchObject({
      type: 'Color',
      rgb: [127.5, 127.5, 127.5],
      bytes: 'rgb(128, 128, 128)'
    });
    expect(difference(blackValue, whiteValue)).toMatchObject({
      type: 'Color',
      bytes: 'rgb(255, 255, 255)'
    });
    expect(exclusion(blackValue, whiteValue)).toMatchObject({ type: 'Color', bytes: 'rgb(255, 255, 255)' });
    expect(multiply(blackValue, whiteValue)).toMatchObject({ type: 'Color', bytes: 'rgb(0, 0, 0)' });
    expect(negation(blackValue, whiteValue).rgb).toEqual([255, 255, 255]);
    expect(screen(blackValue, whiteValue)).toMatchObject({ type: 'Color', bytes: 'rgb(255, 255, 255)' });
  });

  it('handles zero-alpha blend path', () => {
    const transparentBlack = makeColorRgb([0, 0, 0], 0, RGB);
    const transparentWhite = makeColorRgb([255, 255, 255], 0, RGB);
    const result = average(transparentBlack, transparentWhite);
    expect(result.alpha).toBe(0);
  });

  it('uses the canonical implementation registered for Less', () => {
    expect(lessFns.find(fn => fn.name === 'average')).toBe(average);
    expect(lessFns.find(fn => fn.name === 'difference')).toBe(difference);
    expect(lessFns.find(fn => fn.name === 'exclusion')).toBe(exclusion);
    expect(lessFns.find(fn => fn.name === 'multiply')).toBe(multiply);
    expect(lessFns.find(fn => fn.name === 'screen')).toBe(screen);
  });
});
