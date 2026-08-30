import { describe, it, expect } from 'vitest';
import { emitValue, makeDimension, makeKeyword, makeList, type FnCtx, type ValueGroup } from '@jesscss/core';
import extract from '../extract.js';

const ctx: FnCtx = { modes: { unitMode: 'preserve' }, stringify: emitValue };
const call = (...args: ValueGroup[]): ValueGroup => {
  const result = extract(makeList(args, ','), ctx);
  if (result instanceof Promise) {
    throw new TypeError('Expected extract() to be synchronous in this test.');
  }
  return result;
};

describe('extract()', () => {
  it('extracts 1-based item from a list', () => {
    const list = [makeKeyword('a'), makeKeyword('b'), makeKeyword('c')];
    const result = call(list, makeDimension(2));
    expect(result).toMatchObject({ type: 'Keyword', text: 'b' });
  });

  it('throws when index is out of range', () => {
    const list = [makeKeyword('a')];
    expect(() => call(list, makeDimension(0))).toThrow('out of range');
    expect(() => call(list, makeDimension(2))).toThrow('out of range');
  });

  it('returns the canonical selected raw group without cloning source-free values', () => {
    const seq = [makeKeyword('a'), makeKeyword('b')];
    const list = makeList([seq, makeKeyword('c')], ',');

    const result = call(list, makeDimension(1));

    expect(result).toBe(seq);
    expect(emitValue(result)).toBe('a b');
  });

  /*
   * Ledger V7. This used to assert that a non-finite index returns the sole item of
   * a one-item list — a rule about a value that can no longer exist: a non-finite
   * number is rejected at the output boundary, so `makeDimension(Infinity)` never
   * produces a `Dimension` for `extract` to receive. `extract`'s non-finite branch
   * went with the assertion.
   */
  it('cannot be handed a non-finite index at all', () => {
    expect(() => makeDimension(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
