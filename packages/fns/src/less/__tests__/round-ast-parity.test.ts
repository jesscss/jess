import { describe, expect, expectTypeOf, it } from 'vitest';
import { makeDimension, type Dimension as ValueDimension } from '@jesscss/core/value';
import round, { round as namedRound } from '../round.js';

function astRound(value: number, unit: string, precision?: number): ValueDimension {
  const result = precision === undefined
    ? round(makeDimension(value, unit))
    : round(makeDimension(value, unit), makeDimension(precision));
  if (result instanceof Promise || result.type !== 'Dimension') {
    throw new TypeError('round() must synchronously return a dimension');
  }
  return result;
}

describe('round canonical AST parity', () => {
  it('preserves units with default precision', () => {
    expectTypeOf(round).parameter(0).toEqualTypeOf<ValueDimension>();
    expectTypeOf(round).parameter(1).toEqualTypeOf<ValueDimension | undefined>();
    const ast = astRound(2.49, 'px');
    expect(ast).toEqual({ type: 'Dimension', number: 2, unit: 'px', bytes: '2px' });
    expect(namedRound).toBe(round);
  });

  it('uses explicit decimal precision', () => {
    const ast = astRound(2.345, 'px', 2);
    expect(ast).toEqual({ type: 'Dimension', number: 2.35, unit: 'px', bytes: '2.35px' });
  });
});
