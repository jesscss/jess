import { describe, it, expect } from 'vitest';
import { makeDimension } from '@jesscss/core/value';
import sharedRound from '../round.js';

describe('shared round()', () => {
  it('rounds with precision', () => {
    const result = sharedRound(makeDimension(2.345, 'px'), makeDimension(2));
    expect(result).toMatchObject({ type: 'Dimension', number: 2.35, unit: 'px' });
  });

  it('keeps precision optional while rejecting raw JavaScript numbers', () => {
    expect(sharedRound(makeDimension(2.345, 'px'))).toMatchObject({
      type: 'Dimension',
      number: 2,
      unit: 'px'
    });
    expect(() => Reflect.apply(sharedRound, undefined, [2.345])).toThrow('typed ValueObj');
  });
});
