import type { Dimension, ValueGroup, ValueObj } from '@jesscss/core/value';
import { groupItems, isValueGroupArray, unify } from '@jesscss/core/value';
import { compatibleUnits, isUnitlessDimension } from '../shared/math/units.js';

const isDimension = (value: ValueGroup): value is Dimension =>
  !isValueGroupArray(value) && value.type === 'Dimension';

/**
 * Less's `min()`/`max()`.
 *
 * Less COERCES a unitless argument into the reference unit — the display unit of
 * the first unit-bearing argument — and then compares canonically. Sass instead
 * compares display numbers as soon as a unitless operand appears, and that is a
 * genuine semantic difference between the two languages, not an artifact:
 *
 *   max(1px, 1in, 2)   Less → 1in   (2 becomes 2px; 1in is 96px and wins)
 *                      Sass → 2     (display 1, 1, 2)
 *
 * Verified against lessc 4.8.0 and dart-sass 1.101.0. Both are kept; see
 * `sass/math/compare.ts` for the other half.
 *
 * The reference-unit rule is what `min(2px, 1)` → `1` and `min(6em, 5)` → `5`
 * depend on, so "Less does not coerce unitless" is wrong — it coerces, just
 * into the unit rather than out of it. The WINNING ARGUMENT is returned as
 * authored (`max(1px, 2px, 3)` → `3`, not `3px`).
 *
 * Incompatible units FAIL. Nothing here suppresses that: the engine preserves
 * the call verbatim in bare position under the default `functionMode:
 * 'preserve'` and reports it under `'error'`.
 *
 * DELIBERATELY NOT PORTED: less.js emits a PARTIAL reduction for some inputs
 * (`min(6em, 5, 4ex)` → `min(5, 4ex)`), reducing each unit group and emitting
 * the survivors. It reaches that branch only when an intervening unitless
 * argument resets its `unitStatic` bookkeeping, so the same expression reduces
 * or is preserved depending on argument ORDER — `max(1px, 2em, 3px)` is
 * preserved while `min(6em, 5, 4ex)` is reduced. That is an implementation
 * accident, not a semantic, and jess preserves the whole call instead. One Less
 * fixture recorded the old bytes and was graduated with this change.
 */
export function minMax(isMin: boolean, list: ValueGroup): ValueObj {
  const name = isMin ? 'min' : 'max';
  const args = groupItems(list).flatMap(groupItems);
  if (args.length === 0) {
    throw new TypeError(`${name}() requires at least one argument`);
  }

  const numbers: Dimension[] = [];
  for (const arg of args) {
    if (!isDimension(arg)) {
      throw new TypeError(`${name}() requires numeric arguments`);
    }
    numbers.push(arg);
  }

  // The reference unit is the first unit-bearing argument's DISPLAY unit; every
  // unitless argument is read as carrying it.
  const reference = numbers.find(number => !isUnitlessDimension(number));
  const magnitude = (number: Dimension): number => reference === undefined
    ? number.number
    : unify(number.number, isUnitlessDimension(number) ? reference.unit : number.unit).number;

  for (const number of numbers) {
    if (reference !== undefined && !isUnitlessDimension(number) && !compatibleUnits(reference, number)) {
      throw new TypeError(`${name}() arguments have incompatible units`);
    }
  }

  let best = numbers[0]!;
  let bestMagnitude = magnitude(best);
  for (let index = 1; index < numbers.length; index++) {
    const candidate = numbers[index]!;
    const candidateMagnitude = magnitude(candidate);
    if (isMin ? candidateMagnitude < bestMagnitude : candidateMagnitude > bestMagnitude) {
      best = candidate;
      bestMagnitude = candidateMagnitude;
    }
  }
  return best;
}
