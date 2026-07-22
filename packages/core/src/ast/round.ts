/**
 * Lean number rounding, byte-identical to `tree/util/round.ts` — inlined to keep
 * the value domain boundary-clean (no `../tree` import). Replicates lodash's
 * exponential-shift algorithm exactly. Shared by dimension + color serialization.
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
