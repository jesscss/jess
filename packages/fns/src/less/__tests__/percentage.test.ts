import { describe, it, expect } from 'vitest';
import { makeDimension } from '@jesscss/core/value';
import percentage from '../percentage.js';

describe('percentage()', () => {
  it('converts numbers and dimensions to percent dimensions', () => {
    const fromNumber = percentage(makeDimension(0.25));
    const fromDimension = percentage(makeDimension(0.5, 'px'));

    expect(fromNumber.number).toBe(25);
    expect(fromNumber.unit).toBe('%');
    expect(fromDimension.number).toBe(50);
    expect(fromDimension.unit).toBe('%');
  });
});
