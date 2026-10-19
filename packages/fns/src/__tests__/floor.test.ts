import { describe, test, expect, beforeEach } from 'vitest';
import { invoke } from './harness.js';
import { makeDimension } from '@jesscss/core';
import { floor } from '../shared/index.js';

describe('floor function typed value contract', () => {
  test('floors a canonical Dimension and preserves its unit', () => {
    const result = floor(makeDimension(1.7, 'px'));
    expect(result).toMatchObject({ type: 'Dimension', number: 1, unit: 'px', bytes: '1px' });
  });

  test('rejects untyped direct inputs at the callable boundary', () => {
    expect(() => invoke(floor, 1.7)).toThrow('typed value node');
    expect(() => invoke(floor, { value: 1.7 })).toThrow('structural value arguments');
  });

  test('rejects legacy tree numeric values', () => {
    expect(() => invoke(floor, { type: 'Num', value: 1.7 })).toThrow('expected Dimension');
  });
});
