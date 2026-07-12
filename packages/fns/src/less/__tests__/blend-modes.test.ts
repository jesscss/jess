import { describe, it, expect } from 'vitest';
import { Color } from '@jesscss/core';
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
    expect(difference(black, white).rgb).toEqual([255, 255, 255]);
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
});
