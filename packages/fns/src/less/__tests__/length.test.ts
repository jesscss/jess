import { describe, it, expect } from 'vitest';
import { emitValue, makeKeyword, makeList, type ValueGroup } from '@jesscss/core';
import length from '../length.js';

describe('length()', () => {
  it('counts structural value groups without recovering rendered text', () => {
    const list = (value: ValueGroup) => length(makeList([value], ','), {
      modes: { unitMode: 'preserve' }, stringify: emitValue
    });

    expect(list([makeKeyword('a'), makeKeyword('b'), makeKeyword('c')]).number).toBe(3);
    expect(list([makeKeyword('x'), makeKeyword('y')]).number).toBe(2);
    expect(list(makeKeyword('a b c')).number).toBe(1);
    expect(list(makeKeyword('z')).number).toBe(1);
  });
});
