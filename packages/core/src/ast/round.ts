/**
 * Lean number rounding — replicates lodash's exponential-shift algorithm exactly,
 * minus its generic coercion (our inputs are always finite `number`s with a literal
 * precision). The SOLE copy: `tree/util/round.ts` re-exports this one, so the
 * dependency points legacy-tree -> ast and deleting `tree/` leaves the value domain
 * intact.
 *
 * This is the ROUNDING KERNEL, not the output policy — the digits a computed number
 * is written with are decided by `format-number.ts`.
 *
 * TIE DIRECTION is HALF-AWAY-FROM-ZERO (ledger **V8**), not `Math.round`'s
 * half-toward-`+infinity`: `round(-1.5)` is `-2`, not `-1`. `Math.round`'s asymmetry
 * is a JS artifact — it makes the kernel disagree with itself under negation, so
 * `round(-x) !== -round(x)` for every exact half. Away-from-zero is the arithmetic
 * convention, is what a user writing `round()` expects, and is what Sass's
 * `math.round` and Less 4.x (via `toFixed`) both do.
 */
const roundHalf = (n: number): number => (n < 0 ? -Math.round(-n) : Math.round(n));

export function round(number: number, precision?: number): number {
  if (precision === undefined) {
    return roundHalf(number);
  }
  const p = precision < 0 ? 0 : precision > 292 ? 292 : Math.trunc(precision);
  if (p !== 0 && Number.isFinite(number)) {
    if (Number.isInteger(number)) {
      return number;
    }
    let pair = (`${number}e`).split('e');
    const value = roundHalf(Number(`${pair[0]}e${+pair[1]! + p}`));
    pair = (`${value}e`).split('e');
    return Number(`${pair[0]}e${+pair[1]! - p}`);
  }
  return roundHalf(number);
}
