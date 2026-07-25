import type { Dimension, ValueGroup, ValueObj } from '@jesscss/core/value';
import { emitValue, groupItems, isValueGroupArray, unify } from '@jesscss/core/value';
import { compatibleUnits, isUnitlessDimension } from './units.js';

const isDimension = (value: ValueGroup): value is Dimension =>
  !isValueGroupArray(value) && value.type === 'Dimension';

/**
 * `min()`/`max()` — the CSS Values 4 math functions, IDENTICAL in every dialect.
 *
 * CSS Values and Units 4 § 10.2 defines them as taking "a comma-separated list
 * of one or more calculations" and representing "the smallest (most negative) /
 * largest (most positive) of them"; § 10.1 requires the arguments to resolve to
 * the same type. `max(1px, 2em)` is therefore VALID CSS whose value the browser
 * resolves at used-value time — a dialect that rejects it is rejecting CSS, so
 * this body reduces when it can and FAILS when it cannot, leaving the engine to
 * decide what a failure means.
 *
 * This body NEVER emits a verbatim call of its own. Suppressing its own failure
 * is what made `functionMode` silently inert for these two names, and it is the
 * engine's job, not a function's: `evaluator.ts` `recoverCallFailure` preserves
 * the call under the default `functionMode: 'preserve'` and rethrows under
 * `'error'`. Reducibility and validity are different questions and only the
 * first one belongs here.
 *
 * Reduction, verified against BOTH references (lessc 4.8.0, dart-sass 1.101.0):
 *   max(1px, 2px)   → 2px     max(1px, 1in) → 1in     max(3, 1cm) → 3
 *   min(2px, 1)     → 1       max(1px)      → 1px
 * and preserved by both where the units do not reduce:
 *   max(1px, 2em)   max(1px, 2em, 3px)   min(1px, 1%, 2px)   min(a, b)   min()
 *
 * `min(2px, 1)` → `1` is the load-bearing case for the magnitude rule: a
 * unitless argument compares against the other's DISPLAY number, not against a
 * canonicalised one. Hence `min(3, 1cm)` → `1cm` and `max(3, 1cm)` → `3`.
 *
 * `min(1px, 2s)` PRESERVES here, deliberately, and must not be "fixed" by
 * comparing against dart-sass, which errors on it. Strictness is a property of
 * the CALL FORM: a bare call could be a CSS function this compiler does not
 * know, so it preserves; an explicitly namespaced call (`math.min`) is
 * unambiguous and errors. Erroring on the bare form would contradict that rule.
 * (Per § 10.1 `px` vs `s` IS length-vs-time and genuinely invalid CSS, where
 * `px` vs `em` are both `<length>` and merely unreducible — a real distinction,
 * but a VALIDITY diagnostic belongs in the language service. The parser and
 * evaluator accept shapes; they do not adjudicate validity.)
 *
 * `strict` selects the MODULE form (`math.min`/`math.max`), which must raise
 * even where the global form is preserved, and carries Sass's diagnostic
 * wording. Today both forms throw and the engine preserves both alike, because
 * no dialect can yet PARSE a namespaced function call (`math.max(…)` is a
 * syntax error in the SCSS parser and `FunctionCall` has no namespace field) —
 * so nothing can reach dispatch to be told apart. The flag is the seam that
 * lane will attach to; it is not decoration.
 */
export function cssMinMax(isMin: boolean, list: ValueGroup, strict: boolean): ValueObj {
  const name = isMin ? 'min' : 'max';
  const args = groupItems(list).flatMap(groupItems);
  if (args.length === 0) {
    throw new TypeError(strict ? 'At least one argument must be passed.' : `${name}() requires at least one argument`);
  }

  const numbers: Dimension[] = [];
  for (const arg of args) {
    if (!isDimension(arg)) {
      throw new TypeError(strict ? `${emitValue(arg)} is not a number.` : `${name}() requires numeric arguments`);
    }
    numbers.push(arg);
  }

  // The reference unit is the first unit'd argument; a unitless argument keeps
  // its own magnitude, which is what makes `min(3, 1cm)` → `1cm`.
  const reference = numbers.find(number => !isUnitlessDimension(number));
  for (const number of numbers) {
    if (reference !== undefined && !compatibleUnits(reference, number)) {
      throw new TypeError(strict
        ? `${reference.bytes} and ${number.bytes} have incompatible units.`
        : `${name}() arguments have incompatible units`);
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
