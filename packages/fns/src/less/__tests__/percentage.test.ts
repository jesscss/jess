import { describe, it, expect } from 'vitest';
import { invoke, node } from '../../__tests__/harness.js';
import { makeDimension } from '@jesscss/core';
import { lessFns } from '../registry.js';
import { percentage } from '../percentage.js';

describe('percentage()', () => {
  it('converts numbers and dimensions to percent dimensions', () => {
    const fromNumber = node(invoke(percentage, makeDimension(0.25)), 'Dimension');
    const fromDimension = node(invoke(percentage, makeDimension(0.5, 'px')), 'Dimension');

    expect(fromNumber.number).toBe(25);
    expect(fromNumber.unit).toBe('%');
    expect(fromDimension.number).toBe(50);
    expect(fromDimension.unit).toBe('%');
  });

  it('is the same canonical function registered for the Less evaluator', () => {
    expect(lessFns.find(fn => fn.name === 'percentage')).toBe(percentage);
  });
});
