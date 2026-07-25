import type { Dimension } from '@jesscss/core/value';
import { groupOf } from '@jesscss/core/value';

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
 * Sass's spelling of a unit multiset, i.e. what `math.unit()` returns:
 * `px`, `px*px`, `px/s`, `px*s/em`, `px/(s*em)`, `px^-1`, `(px*s)^-1`.
 */
export function unitText(value: Dimension): string {
  const { numerator, denominator } = unitsOf(value);
  if (denominator.length === 0) {
    return numerator.join('*');
  }
  const bottom = denominator.length > 1 ? `(${denominator.join('*')})` : denominator[0]!;
  return numerator.length === 0 ? `${bottom}^-1` : `${numerator.join('*')}/${bottom}`;
}

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
 * `math.compatible()` / `comparable()`: a unitless number is compatible with
 * anything; otherwise both unit multisets must agree group-for-group.
 */
export function compatibleUnits(a: Dimension, b: Dimension): boolean {
  if (isUnitlessDimension(a) || isUnitlessDimension(b)) {
    return true;
  }
  const left = unitsOf(a);
  const right = unitsOf(b);
  return sameKeys(left.numerator, right.numerator) && sameKeys(left.denominator, right.denominator);
}
