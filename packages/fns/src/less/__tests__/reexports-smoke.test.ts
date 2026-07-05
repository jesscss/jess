import { describe, it, expect } from 'vitest';
import { Color, ColorFormat, Dimension } from '@jesscss/core';
import lessAbs from '../abs.js';
import lessAlpha from '../alpha.js';
import lessBlue from '../blue.js';
import lessCeil from '../ceil.js';
import lessGreen from '../green.js';
import lessRed from '../red.js';
import lessRound from '../round.js';

describe('tiny re-export wrappers', () => {
  it('executes shared wrapper modules and returns expected values', () => {
    expect(lessAbs(new Dimension({ number: -3, unit: 'px' })).number).toBe(3);
    expect(lessAbs(new Dimension({ number: -3, unit: 'px' })).unit).toBe('px');
    expect(lessCeil(new Dimension({ number: 2.1, unit: 'px' })).number).toBe(3);
    expect(lessCeil(new Dimension({ number: 2.1, unit: 'px' })).unit).toBe('px');
    expect(lessRound(new Dimension({ number: 2.49, unit: 'px' })).number).toBe(2);
    expect(lessRound(new Dimension({ number: 2.49, unit: 'px' })).unit).toBe('px');

    const color = new Color({
      rgb: [12, 34, 56],
      format: ColorFormat.RGB,
      alpha: 0.5
    });
    expect(lessRed(color).number).toBe(12);
    expect(lessGreen(color).number).toBe(34);
    expect(lessBlue(color).number).toBe(56);
    expect(lessAlpha(color).number).toBe(0.5);
  });
});
