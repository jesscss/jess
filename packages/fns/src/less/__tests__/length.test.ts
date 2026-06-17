import { describe, it, expect } from 'vitest';
import { Any, List, Sequence } from '@jesscss/core';
import length from '../length.js';

describe('length()', () => {
  it('counts values from list-with-sequence, sequence, and single nodes', () => {
    const listWithSingleSequence = new List([
      new Sequence([new Any('a'), new Any('b'), new Any('c')])
    ]);
    const sequence = new Sequence([new Any('x'), new Any('y')]);
    const single = new Any('z');

    expect(length(listWithSingleSequence).number).toBe(3);
    expect(length(sequence).number).toBe(2);
    expect(length(single).number).toBe(1);
  });
});
