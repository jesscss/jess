import type { Dimension } from '@jesscss/core';
import { compareOrder } from '@jesscss/core';

/**
 * Sass's numeric COMPARISON rule — what `min`/`max` fold with.
 *
 * This used to be a SECOND numeric comparison living in `fns/`, private to
 * `min`/`max` and carrying its own unit rules. It no longer is: the comparison
 * is `compareOrder`, the shared value primitive every guard, map key and
 * lookup also compares through (§1 — `fns/` CONSUMES the core primitives, it
 * does not reimplement them). "One set of semantics" is true here by
 * construction now rather than by two implementations agreeing.
 *
 * The primitive already IS the rule this file used to spell out. Two operands
 * compare when their units are compatible, OR when either side is unitless —
 * and the unitless clause is not a coercion, it is §4.1's numeric ground with a
 * unitless wildcard, which compares the DISPLAY numbers with no conversion at
 * all. That is what separates Sass from Less here —
 *
 *   max(1px, 1in, 2)   Sass → 2      (display 1, 1, 2)
 *                      Less → 1in    (2 coerced to 2px, compared canonically)
 *
 * — verified against dart-sass 1.101.0 and lessc 4.8.0. A genuine semantic
 * difference between the two languages, so `less/min-max.ts` keeps its own
 * canonical-unit fold; what is shared is the pairwise comparison, not the fold.
 *
 * Returns <0 / 0 / >0 like a comparator; THROWS when no comparison is possible.
 * The message is dart-sass's, not the primitive's, because `min`/`max` report
 * the failing PAIR mid-fold and that diagnostic is observable in sass-spec.
 */
export function compareSassNumbers(a: Dimension, b: Dimension): number {
  try {
    return compareOrder(a, b);
  } catch {
    throw new TypeError(`${a.bytes} and ${b.bytes} have incompatible units.`);
  }
}
