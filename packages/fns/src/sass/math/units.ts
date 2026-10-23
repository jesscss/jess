import type { Dimension } from '@jesscss/core';
import { groupOf } from '@jesscss/core';
import { compatibleUnits, convertNumber, isUnitlessDimension, unitsOf } from '../../shared/math/units.js';

/**
 * The generic unit-multiset helpers live in `shared/math/units.ts` — unit
 * compatibility is a property of CSS units, not of Sass, and `min`/`max` need
 * it in every dialect. Re-exported here so the Sass math modules keep a single
 * import site. Only Sass's SPELLING of a multiset and its argument checks stay
 * below.
 */
export { unitsOf, isUnitlessDimension, compatibleUnits };

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

/** Dart Sass `assertNoUnits`: `$name: Expected 1px to have no units.` */
export function assertNoUnits(value: Dimension, name: string): Dimension {
  if (!isUnitlessDimension(value)) {
    throw new TypeError(`$${name}: Expected ${value.bytes} to have no units.`);
  }
  return value;
}

const ANGLE = groupOf('rad');

/**
 * Dart Sass `coerceValueToUnit('rad')` as the trig members check it: a unitless
 * number or one angle unit (`deg`, `grad`, `rad`, `turn`).
 */
export function assertAngle(value: Dimension, name: string): Dimension {
  const { numerator, denominator } = unitsOf(value);
  if (numerator.length + denominator.length === 0
    || (denominator.length === 0 && numerator.length === 1 && groupOf(numerator[0]!) === ANGLE)) {
    return value;
  }
  throw new TypeError(`$${name}: Expected ${value.bytes} to have an angle unit (deg, grad, rad, turn).`);
}

/**
 * Dart Sass `convertValueToMatch`: `value`'s number in `other`'s units. Stricter
 * than {@link compatibleUnits}: a unitless number does not match a number with
 * units. The message names both arguments, as Dart Sass's does.
 */
export function convertToMatch(value: Dimension, other: Dimension, name: string, otherName: string): number {
  const unitless = isUnitlessDimension(value);
  if (unitless !== isUnitlessDimension(other)) {
    throw new TypeError(`${name}: ${value.bytes} and ${otherName}: ${other.bytes} have incompatible units (one has units and the other doesn't).`);
  }
  if (unitless) {
    return value.number;
  }
  if (!compatibleUnits(value, other)) {
    throw new TypeError(`${name}: ${value.bytes} and ${otherName}: ${other.bytes} have incompatible units.`);
  }
  return convertNumber(value, other);
}
