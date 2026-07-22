import { describe, expect, expectTypeOf, it } from 'vitest';
import { makeDimension, type Dimension as ValueDimension } from '@jesscss/core/value';
import acos, { acos as namedAcos } from '../acos.js';

describe('acos canonical AST-v2 parity', () => {
  it('directly reduces the typed Dimension to the exact canonical node shape', () => {
    expect(typeof acos).toBe('function');
    expect(namedAcos).toBe(acos);
    expect(acos.name).toBe('acos');
    expect(acos.params).toEqual([{ name: 'value', kinds: ['Dimension'] }]);
    expectTypeOf(acos).parameter(0).toEqualTypeOf<ValueDimension>();

    expect(acos(makeDimension(0.5, 'px'))).toEqual({
      type: 'Dimension',
      number: Math.acos(0.5),
      unit: 'rad',
      bytes: '1.04719755rad'
    });
  });

  it('rejects untyped JavaScript arguments at the callable boundary', () => {
    expect(() => acos(0.5 as never)).toThrow('typed ValueObj');
  });
});
