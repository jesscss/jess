import { describe, it, expect } from 'vitest';
import { makeDimension } from '@jesscss/core/value';
import lessRound from '../round.js';

describe('Less round()', () => {
  it('rounds with precision', () => {
    const result = lessRound(makeDimension(2.345, 'px'), makeDimension(2));
    expect(result).toMatchObject({ type: 'Dimension', number: 2.35, unit: 'px' });
  });

  it('keeps precision optional while rejecting raw JavaScript numbers', () => {
    expect(lessRound(makeDimension(2.345, 'px'))).toMatchObject({
      type: 'Dimension',
      number: 2,
      unit: 'px'
    });
    expect(() => Reflect.apply(lessRound, undefined, [2.345])).toThrow('typed ValueObj');
  });
});
