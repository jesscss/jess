/**
 * `sass:math` — the value-domain port (predicates).
 *
 * Every expectation is a sass-spec case (sass-spec
 * `f282e3844db9889a0747b810898f67571272e8e5`, vendored in `node_modules`),
 * cited by hrx file + section. Where sass-spec is silent the case is marked and
 * was run against dart-sass 1.101.0 (`packages/jess/node_modules/.bin/sass`).
 *
* These call the `Fn` bodies directly: there is no SCSS render-and-compare
* harness for `spec/core_functions/**`. The vendored sass-spec cache is
 * PARSE-only (`packages/syntax/scss/scss-parser/scripts/materialize-sass-spec-cache.cjs`
* keeps `input.scss` and drops `output.css`), and no Sass function registry is
 * wired into the compiler yet.
 */
import type { Dimension } from '@jesscss/core';
import { makeDimension } from '@jesscss/core';
import { describe, it, expect } from 'vitest';
import { abs } from '../../shared/index.js';
import { isUnitless, unitless } from '../math/is-unitless.js';
import { compatible, comparable } from '../math/compatible.js';

/** A `1px * 1em`-style arithmetic result, which carries an explicit unit multiset. */
const compound = (
  number: number,
  unit: string,
  numerator: readonly string[],
  denominator: readonly string[]
): Dimension => ({ ...makeDimension(number, unit), numerator, denominator });

describe('sass:math — abs', () => {
  it('spec core_functions/global/math.hrx § abs (genuinely shared with Less)', () => {
    expect(abs(makeDimension(-1))).toMatchObject({ type: 'Dimension', number: 1, unit: '' });
    expect(abs(makeDimension(-10, 'px'))).toMatchObject({ type: 'Dimension', number: 10, unit: 'px' });
  });
});

describe('sass:math — is-unitless / unitless', () => {
  it('spec core_functions/math/unitless.hrx § unitless', () => {
    expect(isUnitless(makeDimension(1))).toMatchObject({ type: 'Bool', value: true });
  });

  it('spec core_functions/math/unitless.hrx § numerator', () => {
    expect(isUnitless(makeDimension(1, 'px'))).toMatchObject({ type: 'Bool', value: false });
  });

  it('spec core_functions/math/unitless.hrx § denominator — math.is-unitless(1/1px)', () => {
    expect(isUnitless(compound(1, 'px', [], ['px']))).toMatchObject({ type: 'Bool', value: false });
  });

  it('spec core_functions/math/unitless.hrx § numerator_and_denominator — math.is-unitless(1px/1em)', () => {
    expect(isUnitless(compound(1, 'px', ['px'], ['em']))).toMatchObject({ type: 'Bool', value: false });
  });

  it('treats % as a unit (dart-sass 1.101.0: unitless(10%) → false)', () => {
    expect(isUnitless(makeDimension(50, '%'))).toMatchObject({ type: 'Bool', value: false });
  });

  it('spec core_functions/math/unitless.hrx § error/wrong_name — module and global names differ', () => {
    expect(isUnitless.name).toBe('is-unitless');
    expect(unitless.name).toBe('unitless');
  });

  it('spec core_functions/global/math.hrx § unitless', () => {
    expect(unitless(makeDimension(1))).toMatchObject({ type: 'Bool', value: true });
  });
});

describe('sass:math — compatible / comparable', () => {
  it('spec core_functions/math/comparable.hrx § unitless/to_unitless', () => {
    expect(compatible(makeDimension(1), makeDimension(2))).toMatchObject({ value: true });
  });

  it('spec core_functions/math/comparable.hrx § unitless/to_unit', () => {
    expect(compatible(makeDimension(1), makeDimension(2, 'px'))).toMatchObject({ value: true });
    expect(compatible(makeDimension(2, 'px'), makeDimension(1))).toMatchObject({ value: true });
  });

  it('spec core_functions/math/comparable.hrx § unit/to_same', () => {
    expect(compatible(makeDimension(1, 'px'), makeDimension(2, 'px'))).toMatchObject({ value: true });
  });

  it('spec core_functions/math/comparable.hrx § unit/to_compatible', () => {
    expect(compatible(makeDimension(1, 'px'), makeDimension(2, 'in'))).toMatchObject({ value: true });
  });

  it('spec core_functions/math/comparable.hrx § unit/to_different', () => {
    expect(compatible(makeDimension(1, 'px'), makeDimension(2, 'em'))).toMatchObject({ value: false });
  });

  it('spec core_functions/math/comparable.hrx § unit/to_inverse — math.compatible(1px, 1/1px)', () => {
    expect(compatible(makeDimension(1, 'px'), compound(1, 'px', [], ['px']))).toMatchObject({ value: false });
  });

  it('separates conversion groups (dart-sass 1.101.0: comparable(1s, 1px) → false)', () => {
    expect(compatible(makeDimension(1, 's'), makeDimension(1, 'px'))).toMatchObject({ value: false });
  });

  it('treats % as its own group (dart-sass 1.101.0: comparable(1%, 1px) → false, comparable(1%, 2%) → true)', () => {
    expect(compatible(makeDimension(1, '%'), makeDimension(1, 'px'))).toMatchObject({ value: false });
    expect(compatible(makeDimension(1, '%'), makeDimension(2, '%'))).toMatchObject({ value: true });
  });

  it('spec core_functions/math/comparable.hrx § error/wrong_name — module and global names differ', () => {
    expect(compatible.name).toBe('compatible');
    expect(comparable.name).toBe('comparable');
  });

  it('spec core_functions/global/math.hrx § comparable', () => {
    expect(comparable(makeDimension(1, 'px'), makeDimension(1, 'in'))).toMatchObject({ value: true });
  });
});
