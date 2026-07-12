import { describe, it, expect } from 'vitest';
import { Any, Dimension, List, Sequence } from '@jesscss/core';
import extract from '../extract.js';

describe('extract()', () => {
  it('extracts 1-based item from a list', () => {
    const list = new List([new Any('a'), new Any('b'), new Any('c')]);
    const result = extract(list, new Dimension({ number: 2, unit: '' }));
    expect(result.valueOf()).toBe('b');
  });

  it('throws when index is out of range', () => {
    const list = new List([new Any('a')]);
    expect(() => extract(list, new Dimension({ number: 0, unit: '' }))).toThrow('out of range');
    expect(() => extract(list, new Dimension({ number: 2, unit: '' }))).toThrow('out of range');
  });

  it('returns an owned sequence while reusing inert source-free leaves', () => {
    const seq = new Sequence([new Any('a'), new Any('b')]);
    const list = new List([seq, new Any('c')]);

    const result = extract(list, new Dimension({ number: 1, unit: '' }));

    expect(result).toBeInstanceOf(Sequence);
    if (!(result instanceof Sequence)) {
      throw new TypeError('Expected extract result to be a Sequence');
    }
    expect(result).not.toBe(seq);
    expect(result.value[0]).toBe(seq.value[0]);
    expect(result.value[0]!.frozen).toBe(true);
    expect(String(result)).toBe('a b');
  });

  it('returns the single item for non-finite index when length is one', () => {
    const single = new List([new Any('solo')]);
    const result = extract(single, new Dimension({ number: Number.POSITIVE_INFINITY, unit: '' }));
    expect(result.valueOf()).toBe('solo');
  });
});
