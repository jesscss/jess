import { describe, it, expect } from 'vitest';
import { makeColorRgb, makeDimension, RGB } from '@jesscss/core/value';
import lessAbs from '../abs.js';
import lessAlpha from '../alpha.js';
import lessBlue from '../blue.js';
import lessCeil from '../ceil.js';
import lessGreen from '../green.js';
import lessRed from '../red.js';
import lessRound from '../round.js';

describe('tiny re-export wrappers', () => {
  it('executes shared wrapper modules and returns expected values', () => {
    expect(lessAbs(makeDimension(-3, 'px'))).toMatchObject({ number: 3, unit: 'px' });
    expect(lessCeil(makeDimension(2.1, 'px'))).toMatchObject({ number: 3, unit: 'px' });
    expect(lessRound(makeDimension(2.49, 'px'))).toMatchObject({ number: 2, unit: 'px' });

    const color = makeColorRgb([12, 34, 56], 0.5, RGB);
    expect(lessRed(color)).toMatchObject({ number: 12, unit: '' });
    expect(lessGreen(color)).toMatchObject({ number: 34, unit: '' });
    expect(lessBlue(color)).toMatchObject({ number: 56, unit: '' });
    expect(lessAlpha(color)).toMatchObject({ number: 0.5, unit: '' });
  });
});
