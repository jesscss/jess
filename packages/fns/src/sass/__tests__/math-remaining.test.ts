/**
 * `sass:math` — the value-domain port (unit, percentage, random, min/max).
 *
 * Sourcing rule as in `math-functions.test.ts`: sass-spec
 * `f282e3844db9889a0747b810898f67571272e8e5` first, cited by hrx file +
 * section; dart-sass 1.101.0 only where the spec is silent, and marked as such.
 *
 * DELIBERATE DEPARTURE from the file this replaces: the old suite asserted
 * `unit(10px, em)` → `10em` and `percentage(0.5px)` → `50%`-with-a-unit-message.
 * Both were Less's semantics wearing a Sass name. dart-sass rejects the two-arg
 * form outright (`unit.hrx` § `error/too_many_args`) and rejects any unit'd
 * argument to `percentage` (`percentage.hrx` § `error/unit`).
 */
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import type { Dimension, ValueGroup } from '@jesscss/core';
import { isValueGroupArray, makeDimension, makeKeyword, makeList } from '@jesscss/core';
import { describe, it, expect } from 'vitest';
import { unit } from '../math/unit.js';
import { percentage } from '../math/percentage.js';
import { random } from '../math/random.js';
import { min, mathMin } from '../math/min.js';
import { max, mathMax } from '../math/max.js';

/** Narrow a synchronous fn result to a Dimension without a type assertion. */
const dimensionOf = (value: MaybePromise<ValueGroup>): Dimension => {
  if (value instanceof Promise || isValueGroupArray(value) || value.type !== 'Dimension') {
    throw new TypeError('expected a Dimension result');
  }
  return value;
};

const compound = (
  number: number,
  displayUnit: string,
  numerator: readonly string[],
  denominator: readonly string[]
): Dimension => ({ ...makeDimension(number, displayUnit), numerator, denominator });

describe('sass:math — unit', () => {
  it('spec core_functions/math/unit.hrx § none', () => {
    expect(unit(makeDimension(1))).toMatchObject({ type: 'Quoted', value: '', quote: '"' });
  });

  it('spec core_functions/math/unit.hrx § one_numerator', () => {
    expect(unit(makeDimension(1, 'px'))).toMatchObject({ value: 'px' });
  });

  it('spec core_functions/math/unit.hrx § multiple_numerators — 1px * 1em * 1rad', () => {
    expect(unit(compound(1, 'px', ['px', 'em', 'rad'], []))).toMatchObject({ value: 'px*em*rad' });
  });

  it('spec core_functions/math/unit.hrx § one_denominator — 1/1px', () => {
    expect(unit(compound(1, 'px', [], ['px']))).toMatchObject({ value: 'px^-1' });
  });

  it('spec core_functions/math/unit.hrx § multiple_denominators — 1 / 1px / 3em / 4rad', () => {
    expect(unit(compound(1, 'px', [], ['px', 'em', 'rad']))).toMatchObject({ value: '(px*em*rad)^-1' });
  });

  it('spec core_functions/math/unit.hrx § numerator_and_denominator/single — 1px / 1em', () => {
    expect(unit(compound(1, 'px', ['px'], ['em']))).toMatchObject({ value: 'px/em' });
  });

  it('spec core_functions/math/unit.hrx § numerator_and_denominator/multiple — 1px * 1em / 1rad / 1s', () => {
    expect(unit(compound(1, 'px', ['px', 'em'], ['rad', 's']))).toMatchObject({ value: 'px*em/(rad*s)' });
  });

  it('spec core_functions/global/math.hrx § unit — the global returns a QUOTED unit, not Less\'s bare number', () => {
    expect(unit(makeDimension(5, 'px'))).toMatchObject({ type: 'Quoted', value: 'px' });
  });

  it('spec core_functions/math/unit.hrx § error/too_many_args — one argument only', () => {
    expect(unit.params).toHaveLength(1);
  });
});

describe('sass:math — percentage', () => {
  it('spec core_functions/math/percentage.hrx § zero', () => {
    expect(percentage(makeDimension(0))).toMatchObject({ type: 'Dimension', number: 0, unit: '%' });
  });

  it('spec core_functions/math/percentage.hrx § small', () => {
    expect(percentage(makeDimension(0.246))).toMatchObject({ number: 24.6, unit: '%' });
  });

  it('spec core_functions/math/percentage.hrx § large', () => {
    expect(percentage(makeDimension(123.456))).toMatchObject({ bytes: '12345.6%' });
  });

  it('spec core_functions/math/percentage.hrx § integer', () => {
    expect(percentage(makeDimension(42))).toMatchObject({ number: 4200, unit: '%' });
  });

  it('spec core_functions/math/percentage.hrx § negative', () => {
    expect(percentage(makeDimension(-0.4))).toMatchObject({ number: -40, unit: '%' });
  });

  it('spec core_functions/math/percentage.hrx § error/unit — rejects a unit, where Less returns 5000%', () => {
    expect(() => percentage(makeDimension(1, '%'))).toThrow('$number: Expected 1% to have no units.');
    expect(() => percentage(makeDimension(50, 'px'))).toThrow('$number: Expected 50px to have no units.');
  });
});

describe('sass:math — random', () => {
  it('spec core_functions/math/random.hrx § no_arg', () => {
    const result = dimensionOf(random());
    expect(result).toMatchObject({ type: 'Dimension', unit: '' });
    expect(result.number).toBeGreaterThanOrEqual(0);
    expect(result.number).toBeLessThan(1);
  });

  it('spec core_functions/math/random.hrx § null', () => {
    expect(dimensionOf(random({ type: 'Nil', bytes: '' })).number).toBeLessThan(1);
  });

  it('spec core_functions/math/random.hrx § one', () => {
    expect(random(makeDimension(1))).toMatchObject({ number: 1 });
  });

  it('spec core_functions/math/random.hrx § one_hundred', () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const value = dimensionOf(random(makeDimension(100))).number;
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('spec core_functions/math/random.hrx § ignores_units', () => {
    expect(random(makeDimension(1, 'px'))).toMatchObject({ number: 1, unit: '' });
  });

  it('spec core_functions/math/random.hrx § within_precision — 1.0000000000001 is the integer 1', () => {
    expect(random(makeDimension(1.0000000000001))).toMatchObject({ number: 1 });
  });

  it('spec core_functions/math/random.hrx § error/decimal', () => {
    expect(() => random(makeDimension(1.5))).toThrow('$limit: 1.5 is not an int.');
  });

  it('spec core_functions/math/random.hrx § error/zero and § error/negative', () => {
    expect(() => random(makeDimension(0))).toThrow('$limit: Must be greater than 0, was 0.');
    expect(() => random(makeDimension(-1))).toThrow('$limit: Must be greater than 0, was -1.');
  });
});

/*
 * `min`/`max` moved to `shared/math/` — they are the CSS math functions and
 * behave identically in every dialect. Their tests (including the strict
 * `math.min`/`math.max` wording) live in `shared/math/__tests__/min-max.test.ts`.
 */
