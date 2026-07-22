import { describe, expect, it } from 'vitest';
import { makeDimension } from '@jesscss/core/value';
import sharedCeil from '../ceil.js';

describe('shared ceil()', () => {
  it('returns a canonical dimension while preserving the unit', () => {
    expect(sharedCeil(makeDimension(2.1, 'px'))).toMatchObject({
      type: 'Dimension',
      number: 3,
      unit: 'px'
    });
  });

  it('rejects raw JavaScript numbers at the canonical callable boundary', () => {
    expect(() => Reflect.apply(sharedCeil, undefined, [2.1])).toThrow('typed ValueObj');
  });
});
