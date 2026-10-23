import type { Dimension } from '@jesscss/core';
import { groupOf, unitFactor } from '@jesscss/core';

/**
 * Unit-multiset helpers shared by every dialect. Nothing here is Sass-specific:
 * unit compatibility is a property of CSS units, and `min`/`max` need it in all
 * four dialects. Sass's own SPELLING of a multiset (`math.unit()`) is a
 * presentation concern and stays in `sass/math/units.ts`.
 */

/**
 * The unit MULTISET behind a dimension. A plain authored dimension carries only
 * its display `unit`; only an arithmetic result stores an explicit
 * `numerator`/`denominator` pair (see `makeCompoundDimension`).
 */
export function unitsOf(value: Dimension): { numerator: readonly string[]; denominator: readonly string[] } {
  return {
    numerator: value.numerator ?? (value.unit === '' ? [] : [value.unit]),
    denominator: value.denominator ?? []
  };
}

export const isUnitlessDimension = (value: Dimension): boolean => {
  const { numerator, denominator } = unitsOf(value);
  return numerator.length === 0 && denominator.length === 0;
};

/**
 * The comparison key for one unit: convertible units collapse to their shared
 * conversion group, everything else (including `%`) stands for itself. Two unit
 * multisets are compatible when their key multisets are equal — which is why
 * `1px`/`1cm` compare but `1px`/`1%` and `1px`/`1px*1px` do not.
 */
const unitKey = (unit: string): string => {
  const group = groupOf(unit);
  return group === undefined ? unit : `g${group}`;
};

const sameKeys = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  const left = a.map(unitKey).sort();
  const right = b.map(unitKey).sort();
  return left.every((key, index) => key === right[index]);
};

/**
 * Whether two dimensions can be compared: a unitless number is compatible with
 * anything; otherwise both unit multisets must agree group-for-group. This is
 * what backs `math.compatible()`/`comparable()` AND `min`/`max` reduction.
 */
export function compatibleUnits(a: Dimension, b: Dimension): boolean {
  if (isUnitlessDimension(a) || isUnitlessDimension(b)) {
    return true;
  }
  const left = unitsOf(a);
  const right = unitsOf(b);
  return sameKeys(left.numerator, right.numerator) && sameKeys(left.denominator, right.denominator);
}

const factorOf = (unit: string): number => unitFactor(unit) ?? 1;

const ratio = (from: readonly string[], to: readonly string[]): number => {
  const left = [...from].sort((a, b) => unitKey(a).localeCompare(unitKey(b)));
  const right = [...to].sort((a, b) => unitKey(a).localeCompare(unitKey(b)));
  let result = 1;
  for (let index = 0; index < left.length; index++) {
    result *= factorOf(left[index]!) / factorOf(right[index]!);
  }
  return result;
};

/**
 * `value`'s number in `target`'s units, for two dimensions {@link compatibleUnits}
 * accepts with units on both sides (`1in` in `px` is `96`). Each unit converts
 * within its own conversion group; a unit outside every group converts only to
 * itself.
 */
export function convertNumber(value: Dimension, target: Dimension): number {
  const from = unitsOf(value);
  const to = unitsOf(target);
  return value.number * ratio(from.numerator, to.numerator) / ratio(from.denominator, to.denominator);
}
