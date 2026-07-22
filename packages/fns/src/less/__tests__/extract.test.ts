import { describe, it, expect } from 'vitest';
import { makeDimension, makeKeyword, makeList, type FnCtx, type ValueObj } from '@jesscss/core/value';
import extract from '../extract.js';

const ctx: FnCtx = { modes: { unitMode: 'preserve' }, stringify: value => value.bytes };
const call = (...args: ValueObj[]): ValueObj => {
  const result = extract(makeList(args, ','), ctx);
  if (result instanceof Promise) {
    throw new TypeError('Expected extract() to be synchronous in this test.');
  }
  return result;
};

describe('extract()', () => {
  it('extracts 1-based item from a list', () => {
    const list = makeList([makeKeyword('a'), makeKeyword('b'), makeKeyword('c')], ' ');
    const result = call(list, makeDimension(2));
    expect(result).toMatchObject({ type: 'Keyword', text: 'b' });
  });

  it('throws when index is out of range', () => {
    const list = makeList([makeKeyword('a')], ' ');
    expect(() => call(list, makeDimension(0))).toThrow('out of range');
    expect(() => call(list, makeDimension(2))).toThrow('out of range');
  });

  it('returns the canonical selected List without cloning source-free values', () => {
    const seq = makeList([makeKeyword('a'), makeKeyword('b')], ' ');
    const list = makeList([seq, makeKeyword('c')], ',');

    const result = call(list, makeDimension(1));

    expect(result).toBe(seq);
    expect(result.bytes).toBe('a b');
  });

  it('returns the single item for non-finite index when length is one', () => {
    const single = makeList([makeKeyword('solo')], ' ');
    const result = call(single, makeDimension(Number.POSITIVE_INFINITY));
    expect(result).toMatchObject({ type: 'Keyword', text: 'solo' });
  });
});
