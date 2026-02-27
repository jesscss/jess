import { describe, it, expect } from 'vitest';
import { Color, Dimension } from '@jesscss/core';
import lessAbs from '../abs.js';
import lessAlpha from '../alpha.js';
import lessBlue from '../blue.js';
import lessCeil from '../ceil.js';
import lessGreen from '../green.js';
import lessRed from '../red.js';
import lessRound from '../round.js';

describe('tiny re-export wrappers', () => {
  it('executes shared wrapper modules and returns expected values', () => {
    expect(lessAbs(new Dimension({ number: -3, unit: 'px' })).value).toEqual({ number: 3, unit: 'px' });
    expect(lessCeil(new Dimension({ number: 2.1, unit: 'px' })).value).toEqual({ number: 3, unit: 'px' });
    expect(lessRound(new Dimension({ number: 2.49, unit: 'px' })).value).toEqual({ number: 2, unit: 'px' });

    const color = new Color({
      rgb: [12, 34, 56],
      format: 'rgb',
      alpha: 0.5
    });
    expect(lessRed(color).value.number).toBe(12);
    expect(lessGreen(color).value.number).toBe(34);
    expect(lessBlue(color).value.number).toBe(56);
    expect(lessAlpha(color).value.number).toBe(0.5);
  });
});
