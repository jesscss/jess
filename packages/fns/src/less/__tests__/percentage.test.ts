import { describe, it, expect } from 'vitest';
import { Dimension } from '@jesscss/core';
import percentage from '../percentage.js';

describe('percentage()', () => {
  it('converts numbers and dimensions to percent dimensions', () => {
    const fromNumber = percentage(0.25);
    const fromDimension = percentage(new Dimension({ number: 0.5, unit: 'px' }));

    expect(fromNumber.value).toEqual({ number: 25, unit: '%' });
    expect(fromDimension.value).toEqual({ number: 50, unit: '%' });
  });
});
