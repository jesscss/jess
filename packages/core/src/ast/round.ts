/**
 * Lean number rounding — replicates lodash's exponential-shift algorithm exactly,
 * minus its generic coercion (our inputs are always finite `number`s with a literal
 * precision). The SOLE copy: `tree/util/round.ts` re-exports this one, so the
 * dependency points legacy-tree -> ast and deleting `tree/` leaves the value domain
 * intact.
 *
 * This is the ROUNDING KERNEL, not the output policy — the digits a computed number
 * is written with are decided by `format-number.ts`.
 */
export function round(number: number, precision?: number): number {
  if (precision === undefined) {
    return Math.round(number);
  }
  const p = precision < 0 ? 0 : precision > 292 ? 292 : Math.trunc(precision);
  if (p !== 0 && Number.isFinite(number)) {
    if (Number.isInteger(number)) {
      return number;
    }
    let pair = (`${number}e`).split('e');
    const value = Math.round(Number(`${pair[0]}e${+pair[1]! + p}`));
    pair = (`${value}e`).split('e');
    return Number(`${pair[0]}e${+pair[1]! - p}`);
  }
  return Math.round(number);
}
