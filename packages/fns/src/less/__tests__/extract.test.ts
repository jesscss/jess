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

  it('normalizes spacing when extracted item is a sequence', () => {
    const seq = new Sequence([new Any('a'), new Any('b')]);
    seq.data[0]!.pre = 8;
    seq.data[1]!.pre = 8;
    const list = new List([seq, new Any('c')]);

    const result = extract(list, new Dimension({ number: 1, unit: '' }));

    expect(result).toBeInstanceOf(Sequence);
    const out = result as Sequence;
    expect(out.data[0]!.pre).toBe(0);
    expect(out.data[1]!.pre).toBe(1);
  });

  it('returns the single item for non-finite index when length is one', () => {
    const single = new List([new Any('solo')]);
    const result = extract(single, new Dimension({ number: Number.POSITIVE_INFINITY, unit: '' }));
    expect(result.valueOf()).toBe('solo');
  });
});
