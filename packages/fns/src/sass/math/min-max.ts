import type { Dimension, ValueGroup, Value } from '@jesscss/core';
import { emitValue, groupItems, isValueGroupArray } from '@jesscss/core';
import { compareSassNumbers } from './compare.js';

const isDimension = (value: ValueGroup): value is Dimension =>
  !isValueGroupArray(value) && value.type === 'Dimension';

/**
 * Sass's `min()`/`max()` — faithful to dart-sass, fold-order artifacts included.
 *
 * This body is deliberately DUMB: it reproduces what dart-sass does rather than
 * what a tidier language would do. `#jess` is where the CSS-faithful rule lives
 * (same `<type>` required, no unitless-vs-length coercion); `#less` carries
 * lessc's; this carries Sass's. Nobody is served by a half-sanitised Sass, and
 * a `.scss` source must compile to what dart-sass would have produced.
 *
 * The rule is a LEFT-TO-RIGHT FOLD with a pairwise legality test: keep a running
 * winner, and each comparison must be legal on its own (compatible units, or
 * either side unitless — see `compareSassNumbers`). Incompatibility is
 * discovered mid-fold, so whether the call succeeds depends on the order the
 * winner happens to take:
 *
 *   min(6em, 5, 4ex, 3, 2pt, 1) → 1        (winner goes unitless immediately)
 *   max(6em, 5, 4ex, 3, 2pt, 1) → fails    (winner stays 6em, then meets 4ex)
 *
 * Same arguments, opposite outcomes. That asymmetry is real dart-sass behaviour
 * and is the reason a set-wide compatibility check is NOT correct here — it
 * would fail both, which is tidier and wrong.
 *
 * Failure is never suppressed. The engine preserves the call verbatim in bare
 * position under the default `functionMode: 'preserve'` and reports it under
 * `'error'`. sass-spec states that split outright (`min.hrx` §
 * `global/README.md`): "min() expressions without a namespace are parsed as
 * calculations unless they contain a Sass feature that's not valid in a
 * calculation." A bare `min()` is a CSS calculation; `math.min` is the
 * SassScript function, and `strict` selects the latter.
 *
 * Oracles — sass-spec `core_functions/math/{min,max}.hrx` where it covers the
 * case, dart-sass 1.101.0 directly where it does not (marked *):
 *   math.min(3, 1, 2)        → 1        § three_args
 *   math.min(6px, 2px, 10px) → 2px      § units/same
 *   math.min(1px, 1in, 1cm)  → 1px      § units/compatible
 *   math.min(2px, 1)         → 1        § units/and_unitless
 *   min(1px, 2px,)           → 1px      § global/trailing_comma
 *   math.min()               → Error    § error/too_few_args
 *   math.min(1, c)           → Error    § error/type
 *   max(1px, 1in, 2)         → 2        *  min(1px, 1in, 2)  → 1px  *
 *   max(1px, 2px, 3)         → 3        *  min(1px, 2px, 3)  → 1px  *
 *   max(1%, 2, 3%)           → 3%       *  min(1%, 2, 3%)    → 1%   *
 *   max(1px, 2em)            → fails    *  min(6em, 4ex, 2pt)→ fails *
 *
 * `ce4e942c1` claimed sass-spec verification for an earlier body that had no
 * unitless rule at all — which § `units/and_unitless` would have caught. Treat
 * that commit's citations as unverified; these were re-checked against the
 * installed corpus and the binary.
 */
export function sassMinMax(isMin: boolean, list: ValueGroup, strict: boolean): Value {
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

  let best = numbers[0]!;
  for (let index = 1; index < numbers.length; index++) {
    const candidate = numbers[index]!;

    /*
     * Throws here, mid-fold, exactly where dart-sass gives up. The running
     * winner is the LEFT operand so the diagnostic names the pair in dart-sass's
     * order ("1px and 2em have incompatible units.").
     */
    const ordering = compareSassNumbers(best, candidate);
    if (isMin ? ordering > 0 : ordering < 0) {
      best = candidate;
    }
  }
  return best;
}
