import { describe, expect, expectTypeOf, it } from 'vitest';
import { invoke } from '../../__tests__/harness.js';
import { makeDimension, type Dimension as ValueDimension, type FunctionArgs } from '@jesscss/core';
import acos, { acos as namedAcos } from '../acos.js';

describe('acos canonical AST-v2 parity', () => {
  it('directly reduces the typed Dimension to the exact canonical node shape', () => {
    expect(typeof acos).toBe('function');
    expect(namedAcos).toBe(acos);
    expect(acos.name).toBe('acos');
    expect(acos.params).toEqual([{ name: 'value', type: 'Dimension' }]);
    expectTypeOf<FunctionArgs<typeof acos.params>>().toEqualTypeOf<[ValueDimension]>();

    expect(acos(makeDimension(0.5, 'px'))).toEqual({
      type: 'Dimension',
      number: Math.acos(0.5),
      unit: 'rad',
      bytes: '1.0471975512rad'
    });
  });

  it('rejects untyped JavaScript arguments at the callable boundary', () => {
    expect(() => invoke(acos, 0.5)).toThrow('typed value node');
  });
});
