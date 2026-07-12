import {
  abs,
  acos,
  asin,
  atan,
  ceil,
  cos,
  floor,
  sin,
  sqrt,
  tan
} from '../less/index.js';

import { Context, Dimension } from '@jesscss/core';
import { beforeAll, describe, it, test, expect } from 'vitest';

let context: Context;
let dim: Dimension;

describe('math', () => {
  beforeAll(() => {
    context = new Context();
    dim = new Dimension({ number: 2.4, unit: 'px' });
  });
  it('rejects a non-dimension', () => {
    // @ts-expect-error - incorrect type
    expect(() => floor('1')).toThrowError('Argument \'value\' must be one of:');
  });

  test('abs', () => {
    expect(abs(new Dimension({ number: -2.4, unit: 'px' }))).toEqual(new Dimension({ number: 2.4, unit: 'px' }));
  });

  test('acos', () => {
    expect(acos(new Dimension({ number: 0.5, unit: 'px' }))).toEqual(new Dimension({ number: 1.0471975511965979, unit: 'rad' }));
  });

  test('asin', () => {
    expect(asin(new Dimension({ number: 0.5, unit: 'px' }))).toEqual(new Dimension({ number: 0.5235987755982989, unit: 'rad' }));
  });

  test('atan', () => {
    expect(atan(new Dimension({ number: 0.5, unit: 'px' }))).toEqual(new Dimension({ number: 0.4636476090008061, unit: 'rad' }));
  });

  test('ceil', () => {
    expect(ceil(dim)).toEqual(new Dimension({ number: 3, unit: 'px' }));
  });

  test('cos', () => {
    expect(cos(dim)).toEqual(new Dimension({ number: -0.7373937155412454, unit: '' }));
  });

  test('floor', () => {
    expect(floor(dim)).toEqual(new Dimension({ number: 2, unit: 'px' }));
  });

  test('sin', () => {
    expect(sin(dim)).toEqual(new Dimension({ number: 0.675463180551151, unit: '' }));
  });

  test('sqrt', () => {
    expect(sqrt(dim)).toEqual(new Dimension({ number: 1.5491933384829668, unit: 'px' }));
  });

  test('tan', () => {
    expect(tan(dim)).toEqual(new Dimension({ number: -0.9160142896734107, unit: '' }));
  });
});