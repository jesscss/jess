import type { Dimension } from '@jesscss/core/value';
import { unitsOf } from '../../shared/math/units.js';

/**
 * The generic unit-multiset helpers live in `shared/math/units.ts` — unit
 * compatibility is a property of CSS units, not of Sass, and `min`/`max` need
 * it in every dialect. Re-exported here so the Sass math modules keep a single
 * import site. Only Sass's SPELLING of a multiset stays below.
 */
export { unitsOf, isUnitlessDimension, compatibleUnits } from '../../shared/math/units.js';

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
