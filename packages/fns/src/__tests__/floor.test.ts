import { describe, test, expect, beforeEach } from 'vitest';
import { makeDimension } from '@jesscss/core/value';
import floor from '../less/floor.js';

describe('floor function typed value contract', () => {
  test('floors a canonical Dimension and preserves its unit', () => {
    const result = floor(makeDimension(1.7, 'px'));
    expect(result).toMatchObject({ type: 'Dimension', number: 1, unit: 'px', bytes: '1px' });
  });

  test('rejects untyped direct inputs at the callable boundary', () => {
    expect(() => (floor as unknown as (...args: unknown[]) => unknown)(1.7)).toThrow('typed ValueObj');
    expect(() => (floor as unknown as (...args: unknown[]) => unknown)({ value: 1.7 })).toThrow('typed ValueObj');
  });

  test('rejects legacy tree numeric values', () => {
    expect(() => (floor as unknown as (...args: unknown[]) => unknown)({ type: 'Num', value: 1.7 })).toThrow('expected Dimension');
  });
});
