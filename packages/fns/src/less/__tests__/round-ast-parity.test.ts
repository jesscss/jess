import { describe, expect, it } from 'vitest';
import { Dimension } from '@jesscss/core';
import { makeDimension, makeList, type Dimension as ValueDimension } from '@jesscss/core/value';
import legacyRound, { round } from '../round.js';
import { builtinLessFns } from '../../builtins/index.js';
import { makeBuiltinRegistry } from '../../builtins/registry.js';

const context = {
  modes: {
    mathMode: 'parens-division',
    unitMode: 'preserve',
    functionMode: 'preserve',
    equalityMode: 'less'
  },
  stringify: (value: { bytes: string }) => value.bytes
};

function astRound(value: number, unit: string, precision?: number): ValueDimension {
  const args = [makeDimension(value, unit)];
  if (precision !== undefined) {
    args.push(makeDimension(precision));
  }
  const result = makeBuiltinRegistry().dispatch('round', makeList(args, ' '), context);
  if (result instanceof Promise || result.type !== 'Dimension') {
    throw new TypeError('round() must synchronously return a dimension');
  }
  return result;
}

describe('round canonical AST parity', () => {
  it('matches the retained Less callable for unit preservation and default precision', () => {
    const legacy = legacyRound(new Dimension({ number: 2.49, unit: 'px' }));
    const ast = astRound(2.49, 'px');
    expect(ast).toEqual({ type: 'Dimension', number: legacy.number, unit: legacy.unit, bytes: '2px' });
    expect(builtinLessFns.find(fn => fn.name === 'round')).toBe(round);
  });

  it('matches the retained Less callable for explicit decimal precision', () => {
    const legacy = legacyRound(new Dimension({ number: 2.345, unit: 'px' }), 2);
    const ast = astRound(2.345, 'px', 2);
    expect(ast).toEqual({ type: 'Dimension', number: legacy.number, unit: legacy.unit, bytes: '2.35px' });
  });
});
