import { describe, expect, it } from 'vitest';
import { makeDimension } from '@jesscss/core';
import sharedFloor from '../floor.js';

describe('shared floor()', () => {
  it('returns a canonical dimension while preserving the unit', () => {
    expect(sharedFloor(makeDimension(2.9, 'px'))).toMatchObject({
      type: 'Dimension',
      number: 2,
      unit: 'px'
    });
  });

  it('rejects raw JavaScript numbers at the canonical callable boundary', () => {
    expect(() => Reflect.apply(sharedFloor, undefined, [2.9])).toThrow('typed value node');
  });
});
