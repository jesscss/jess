/**
 * `sass:math` `round` — tie direction.
 *
 * An exact half breaks away from zero through the shared `@jesscss/core` rounding
 * kernel (ledger V8), the rule Less's `round()` uses too. Every expectation is
 * dart-sass 1.101.7 output for the same call.
 */
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import type { ValueGroup } from '@jesscss/core';
import { isValueGroupArray, makeDimension } from '@jesscss/core';
import { describe, it, expect } from 'vitest';
import { round } from '../math/round.js';

const numberOf = (value: MaybePromise<ValueGroup>): number => {
  if (value instanceof Promise || isValueGroupArray(value) || value.type !== 'Dimension') {
    throw new TypeError('expected a Dimension result');
  }
  return value.number;
};

describe('sass:math — round ties', () => {
  it('breaks an exact tie away from zero', () => {
    expect(numberOf(round(makeDimension(2.5)))).toBe(3);
    expect(numberOf(round(makeDimension(-0.5)))).toBe(-1);
    expect(numberOf(round(makeDimension(-1.5)))).toBe(-2);
    expect(numberOf(round(makeDimension(-2.5)))).toBe(-3);
  });

  it('rounds a negative value that lands on zero to zero', () => {
    expect(Math.abs(numberOf(round(makeDimension(-0.4))))).toBe(0);
  });

  it('breaks a step tie away from zero, whatever the step sign', () => {
    expect(numberOf(round(makeDimension(-2.5), makeDimension(1)))).toBe(-3);
    expect(numberOf(round(makeDimension(-0.75), makeDimension(0.5)))).toBe(-1);
    expect(numberOf(round(makeDimension(2.5), makeDimension(-1)))).toBe(3);
    expect(numberOf(round(makeDimension(-101), makeDimension(-25)))).toBe(-100);
  });
});
