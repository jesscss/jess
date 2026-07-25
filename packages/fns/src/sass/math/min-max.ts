import type { Dimension, ValueGroup, ValueObj } from '@jesscss/core/value';
import { emitValue, groupItems, isValueGroupArray, makeKeyword, unify } from '@jesscss/core/value';
import { compatibleUnits, isUnitlessDimension } from './units.js';

const isDimension = (value: ValueGroup): value is Dimension =>
  !isValueGroupArray(value) && value.type === 'Dimension';

/**
 * Sass's `min()`/`max()` survivor policy.
 *
 * The GLOBAL `min()`/`max()` are CSS calculations first: dart-sass simplifies
 * them to a number only when every argument is a number and the units all
 * reduce; otherwise the call survives verbatim as plain CSS. That is the whole
 * reason Sass cannot borrow Less's body — Less RAISES on the cases Sass emits.
 *
 * Verified against `spec/core_functions/math/{min,max}.hrx`:
 *   math.min(3, 1, 2)        → 1        math.max(3, 1, 2)        → 3
 *   math.min(6px, 2px, 10px) → 2px      math.max(6px, 2px, 10px) → 10px
 *   math.min(1px, 1in, 1cm)  → 1px      math.max(1px, 1in, 1cm)  → 1in
 *   math.min(2px, 1)         → 1        math.max(2px, 1)         → 2px
 *   min(1px, 2px,)           → 1px      max(1px, 2px,)           → 2px
 *   math.min()               → Error: At least one argument must be passed.
 *   math.min(1, c)           → Error: c is not a number.
 *   math.min(1px, 2s)        → Error: 1px and 2s have incompatible units.
 *
 * `math.min(2px, 1)` → `1` is the load-bearing case for the magnitude rule: a
 * unitless argument compares against the other's DISPLAY number, not against a
 * canonicalised one. Confirmed with dart-sass 1.101.0 where the spec is silent:
 * `min(3, 1cm)` → `1cm` and `max(3, 1cm)` → `3`.
 *
 * Where the GLOBAL and module forms part company — verified with dart-sass
 * 1.101.0, since sass-spec covers only the reducible global cases:
 *   max(1px, 2em)      → max(1px, 2em)      / math.max(1px, 2em) → Error
 *   max(1px, 1%)       → max(1px, 1%)       (`%` is in no conversion group)
 *   min(1px, var(--x)) → min(1px, var(--x))
 *   min(a, b)          → min(a, b)          / math.min(a, b)     → Error
 *   min()              → Error: Missing argument.
 */
export function sassMinMax(isMin: boolean, list: ValueGroup, strict: boolean): ValueObj {
  const name = isMin ? 'min' : 'max';
  const args = groupItems(list).flatMap(groupItems);
  if (args.length === 0) {
    throw new TypeError(strict ? 'At least one argument must be passed.' : 'Missing argument.');
  }

  const verbatim = (): ValueObj => makeKeyword(`${name}(${args.map(emitValue).join(', ')})`);

  const numbers: Dimension[] = [];
  for (const arg of args) {
    if (!isDimension(arg)) {
      if (strict) {
        throw new TypeError(`${emitValue(arg)} is not a number.`);
      }
      return verbatim();
    }
    numbers.push(arg);
  }

  // The reference unit is the first unit'd argument; a unitless argument keeps
  // its own magnitude, which is what makes `min(3, 1cm)` → `1cm`.
  const reference = numbers.find(number => !isUnitlessDimension(number));
  for (const number of numbers) {
    if (reference !== undefined && !compatibleUnits(reference, number)) {
      if (strict) {
        throw new TypeError(`${reference.bytes} and ${number.bytes} have incompatible units.`);
      }
      return verbatim();
    }
  }

  // Scale relative to the reference unit rather than to each group's canonical
  // unit, so a unitless argument keeps comparing against the DISPLAY number.
  const referenceScale = reference === undefined ? 1 : unify(1, reference.unit).number;
  const magnitude = (number: Dimension): number => reference === undefined || isUnitlessDimension(number)
    ? number.number
    : unify(number.number, number.unit).number / referenceScale;

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
