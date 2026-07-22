import { describe, it, expect } from 'vitest';
import { Color } from '@jesscss/core';
import { makeColorRgb, RGB } from '@jesscss/core/value';
import { builtinLessFns } from '../../builtins/index.js';
import { difference as builtinDifference } from '../../builtins/difference.js';
import average from '../average.js';
import difference from '../difference.js';
import exclusion from '../exclusion.js';
import multiply from '../multiply.js';
import negation from '../negation.js';
import screen from '../screen.js';

describe('less blend modes', () => {
  it('blends black and white as expected', () => {
    const black = new Color({ rgb: [0, 0, 0], alpha: 1 });
    const white = new Color({ rgb: [255, 255, 255], alpha: 1 });

    expect(average(black, white)._rgb).toEqual([127.5, 127.5, 127.5]);
    const blackValue = makeColorRgb([0, 0, 0], 1, RGB);
    const whiteValue = makeColorRgb([255, 255, 255], 1, RGB);
    expect(difference(blackValue, whiteValue)).toMatchObject({
      type: 'Color',
      bytes: 'rgb(255, 255, 255)'
    });
    expect(exclusion(black, white).rgb).toEqual([255, 255, 255]);
    expect(multiply(black, white).rgb).toEqual([0, 0, 0]);
    expect(negation(black, white).rgb).toEqual([255, 255, 255]);
    expect(screen(black, white).rgb).toEqual([255, 255, 255]);
  });

  it('handles zero-alpha blend path', () => {
    const transparentBlack = new Color({ rgb: [0, 0, 0], alpha: 0 });
    const transparentWhite = new Color({ rgb: [255, 255, 255], alpha: 0 });
    const result = average(transparentBlack, transparentWhite);
    expect(result.alpha).toBe(0);
  });

  it('uses the canonical implementation registered for Less', () => {
    expect(difference).toBe(builtinDifference);
    expect(builtinLessFns.find(fn => fn.name === 'difference')).toBe(builtinDifference);
  });
});
