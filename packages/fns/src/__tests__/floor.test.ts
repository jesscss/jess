import { describe, test, expect, beforeEach } from 'vitest';
import { makeDimension } from '@jesscss/core/value';
import { floor } from '../shared/index.js';

function invoke(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== 'function') {
    throw new TypeError('Expected a callable function.');
  }
  return Reflect.apply(fn, undefined, args);
}

describe('floor function typed value contract', () => {
  test('floors a canonical Dimension and preserves its unit', () => {
    const result = floor(makeDimension(1.7, 'px'));
    expect(result).toMatchObject({ type: 'Dimension', number: 1, unit: 'px', bytes: '1px' });
  });

  test('rejects untyped direct inputs at the callable boundary', () => {
    expect(() => invoke(floor, 1.7)).toThrow('typed ValueObj');
    expect(() => invoke(floor, { value: 1.7 })).toThrow('structural value arguments');
  });

  test('rejects legacy tree numeric values', () => {
    expect(() => invoke(floor, { type: 'Num', value: 1.7 })).toThrow('expected Dimension');
  });
});
