import { abs, acos, asin, atan, ceil, cos, floor, sin, sqrt, tan } from '../less/index.js';

import { makeDimension } from '@jesscss/core';
import { describe, it, test, expect } from 'vitest';
import { invoke } from './harness.js';

describe('math', () => {
  const dim = makeDimension(2.4, 'px');
  it('rejects a non-dimension', () => {
    expect(() => invoke(floor, '1')).toThrow();
  });

  test('abs', () => {
    expect(abs(makeDimension(-2.4, 'px'))).toMatchObject({ number: 2.4, unit: 'px' });
  });

  test('acos', () => {
    expect(acos(makeDimension(0.5, 'px'))).toMatchObject({ number: 1.0471975511965979, unit: 'rad' });
  });

  test('asin', () => {
    expect(invoke(asin, makeDimension(0.5, 'px'))).toMatchObject({ number: 0.5235987755982989, unit: 'rad' });
  });

  test('atan', () => {
    expect(invoke(atan, makeDimension(0.5, 'px'))).toMatchObject({ number: 0.4636476090008061, unit: 'rad' });
  });

  test('ceil', () => {
    expect(ceil(dim)).toMatchObject({ number: 3, unit: 'px' });
  });

  test('cos', () => {
    expect(invoke(cos, dim)).toMatchObject({ number: -0.7373937155412454, unit: '' });
  });

  test('floor', () => {
    expect(floor(dim)).toMatchObject({ number: 2, unit: 'px' });
  });

  test('sin', () => {
    expect(invoke(sin, dim)).toMatchObject({ number: 0.675463180551151, unit: '' });
  });

  test('sqrt', () => {
    expect(invoke(sqrt, dim)).toMatchObject({ number: 1.5491933384829668, unit: 'px' });
  });

  test('tan', () => {
    expect(invoke(tan, dim)).toMatchObject({ number: -0.9160142896734107, unit: '' });
  });
});
