import { describe, expect, it } from 'vitest';
import { Dimension } from '@jesscss/core';
import { makeDimension } from '@jesscss/core/value';
import legacyAcos, { acos } from '../acos.js';

describe('acos canonical AST-v2 parity', () => {
  it('directly reduces the typed Dimension to the exact canonical node shape', () => {
    expect(acos).toMatchObject({
      name: 'acos',
      params: [{ kinds: ['Dimension'] }]
    });

    expect(acos.body(makeDimension(0.5, 'px'))).toEqual({
      type: 'Dimension',
      number: Math.acos(0.5),
      unit: 'rad',
      bytes: '1.04719755rad'
    });
  });

  it('retains the established Less callable result while the duplicate AST body is removed', () => {
    const legacy = legacyAcos(new Dimension({ number: 0.5, unit: 'px' }));
    const ast = acos.body(makeDimension(0.5, 'px'));

    expect(legacy.toString()).toBe('1.04719755rad');
    expect(ast).toMatchObject({ bytes: legacy.toString() });
  });
});
