import { describe, it, expect } from 'vitest';
import { makeDimension } from '@jesscss/core';
import lessRound from '../round.js';

describe('Less round()', () => {
  it('rounds with precision', () => {
    const result = lessRound(makeDimension(2.345, 'px'), makeDimension(2));
    expect(result).toMatchObject({ type: 'Dimension', number: 2.35, unit: 'px' });
  });

  it('breaks an exact tie toward +infinity, at any precision', () => {
    const px = (n: number) => makeDimension(n, 'px');
    expect(lessRound(px(2.5))).toMatchObject({ number: 3, unit: 'px' });
    expect(lessRound(px(-1.5))).toMatchObject({ number: -1, unit: 'px' });
    expect(lessRound(px(-2.5))).toMatchObject({ number: -2, unit: 'px' });
    expect(lessRound(px(1.55), makeDimension(1))).toMatchObject({ number: 1.6, unit: 'px' });
    expect(lessRound(px(-1.55), makeDimension(1))).toMatchObject({ number: -1.5, unit: 'px' });
  });

  it('keeps precision optional while rejecting raw JavaScript numbers', () => {
    expect(lessRound(makeDimension(2.345, 'px'))).toMatchObject({
      type: 'Dimension',
      number: 2,
      unit: 'px'
    });
    expect(() => Reflect.apply(lessRound, undefined, [2.345])).toThrow('typed value node');
  });
});
