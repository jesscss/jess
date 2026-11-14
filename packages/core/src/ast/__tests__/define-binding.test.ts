import { describe, expect, it } from 'vitest';
import { NULL, NULL_LITERAL, checkDimension, define, defineFunction, emitValue, lazy, makeDimension, optional, rest, type FnCtx, type ValueGroup } from '../../value.js';

const ctx: FnCtx = { modes: { mathMode: 'parens-division', unitMode: 'preserve', functionMode: 'preserve' }, stringify: emitValue };
const px = (n: number): ValueGroup => makeDimension(n, 'px');
const call = (fn: unknown, ...args: unknown[]): unknown => {
  if (typeof fn !== 'function') {
    throw new TypeError('not a function');
  }
  return Reflect.apply(fn, undefined, [args, ctx]);
};
const run = (thunk: unknown): unknown => {
  if (typeof thunk !== 'function') {
    throw new TypeError('not a thunk');
  }
  return Reflect.apply(thunk, undefined, []);
};
const seen = (...bound: unknown[]): ValueGroup => {
  last = bound;
  return NULL;
};
let last: unknown[] = [];

describe('binding a parameter through its wrapper', () => {
  it('refuses, where the function is defined, a flag its check does not bind', () => {
    expect(() => define('f', { params: [{ name: 'n', type: 'Dimension', check: checkDimension, rest: true }], body: seen }))
      .toThrow('f: a flag needs its wrapper');
    expect(() => define('f', { params: [{ type: 'Dimension', check: checkDimension, optional: true }], body: seen }))
      .toThrow('f: a flag needs its wrapper');
  });

  it('wraps a flag defineFunction is given beside its own check', () => {
    const f = defineFunction('f', { params: [{ name: 'n', type: 'Dimension', check: checkDimension, rest: true }], body: seen });
    call(f, px(1), px(2));
    expect(last).toEqual([[px(1), px(2)]]);
    call(f);
    expect(last).toEqual([[]]);
    const g = defineFunction('g', { params: [{ name: 'n', type: 'Dimension', check: checkDimension, optional: true }], body: seen });
    call(g);
    expect(last).toEqual([undefined]);
    call(g, NULL);
    expect(last).toEqual([undefined]);
  });

  it('reads core\'s implicit null as not passed, lazy or not; an explicit null is a value', () => {
    const f = define('f', { params: [optional(lazy({ name: 'n', type: 'Dimension', check: checkDimension }))], body: seen });
    call(f, NULL);
    expect(last).toEqual([undefined]);
    call(f, NULL_LITERAL);
    expect(typeof last[0]).toBe('function');
    expect(() => run(last[0])).toThrow('expected Dimension');
  });

  it('takes one array given at a lazy rest slot as its arguments, each a thunk', () => {
    const f = define('f', { params: [rest(lazy({ name: 'n', type: 'Dimension', check: checkDimension }))], body: seen });
    call(f, [px(1), px(2)]);
    const thunks: unknown = last[0];
    expect(Array.isArray(thunks) && thunks.map(run)).toEqual([px(1), px(2)]);
  });
});
