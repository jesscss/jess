import { describe, it, expect } from 'vitest';
import { makeKeyword, makeList } from '@jesscss/core/value';
import length from '../length.js';

describe('length()', () => {
  it('counts recovered typed list values and scalar values', () => {
    const list = (value: ReturnType<typeof makeKeyword>) => length(makeList([value], ','), {
      modes: { unitMode: 'preserve' }, stringify: item => item.bytes
    });

    expect(list(makeKeyword('a b c')).number).toBe(3);
    expect(list(makeKeyword('x y')).number).toBe(2);
    expect(list(makeKeyword('z')).number).toBe(1);
  });
});
