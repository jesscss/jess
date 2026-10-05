/**
 * `sass:math` `round` — tie direction.
 *
 * Ties follow CSS Values 4 `round(nearest, A, B)` (§10.3): an exact half goes to the
 * UPPER multiple, toward `+infinity`. This is the shared `@jesscss/core` rounding
 * kernel, the same rule Less's `round()` uses. dart-sass 1.101 rounds negative halves
 * away from zero instead (`math.round(-2.5)` → `-3`, `round(-2.5, 1)` → `-3`); sass-spec
 * has no negative-half case, so this departs from dart-sass only, deliberately.
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
  it('breaks an exact tie toward +infinity', () => {
    expect(numberOf(round(makeDimension(2.5)))).toBe(3);
    expect(Math.abs(numberOf(round(makeDimension(-0.5))))).toBe(0);
    expect(numberOf(round(makeDimension(-1.5)))).toBe(-1);
    expect(numberOf(round(makeDimension(-2.5)))).toBe(-2);
  });

  it('breaks a step tie toward +infinity, whatever the step sign', () => {
    expect(numberOf(round(makeDimension(-2.5), makeDimension(1)))).toBe(-2);
    expect(numberOf(round(makeDimension(-0.75), makeDimension(0.5)))).toBe(-0.5);
    expect(numberOf(round(makeDimension(2.5), makeDimension(-1)))).toBe(3);
    expect(numberOf(round(makeDimension(-101), makeDimension(-25)))).toBe(-100);
  });
});
