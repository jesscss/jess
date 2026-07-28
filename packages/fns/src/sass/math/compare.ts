import type { Dimension } from '@jesscss/core/value';
import { unify } from '@jesscss/core/value';
import { compatibleUnits, isUnitlessDimension } from '../../shared/math/units.js';

/**
 * Sass's numeric COMPARISON rule — what `min`/`max` fold with.
 *
 * Two operands compare when their units are compatible, OR when either side is
 * unitless. The second clause is not a coercion: a unitless operand makes the
 * comparison happen on the DISPLAY numbers, with no conversion at all. That is
 * what separates Sass from Less here —
 *
 *   max(1px, 1in, 2)   Sass → 2      (display 1, 1, 2)
 *                      Less → 1in    (2 coerced to 2px, compared canonically)
 *
 * — verified against dart-sass 1.101.0 and lessc 4.8.0. A genuine semantic
 * difference between the two languages, so both are kept.
 *
 * Because Sass never converts once a unitless operand appears, this stays a
 * comparison utility and does NOT gain unit conversion. Coercing an argument to
 * a required unit (as `adjust-hue` does with angles) is a different operation.
 *
 * Returns <0 / 0 / >0 like a comparator; THROWS when no comparison is possible.
 * The caller folds and decides what a failure means.
 */
export function compareSassNumbers(a: Dimension, b: Dimension): number {
  if (isUnitlessDimension(a) || isUnitlessDimension(b)) {
    return a.number - b.number;
  }
  if (!compatibleUnits(a, b)) {
    throw new TypeError(`${a.bytes} and ${b.bytes} have incompatible units.`);
  }
  return unify(a.number, a.unit).number - unify(b.number, b.unit).number;
}
