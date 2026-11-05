/**
 * Lean number rounding — replicates lodash's exponential-shift algorithm exactly,
 * minus its generic coercion (our inputs are always finite `number`s with a literal
 * precision). The SOLE copy.
 *
 * This is the ROUNDING KERNEL, not the output policy — the digits a computed number
 * is written with are decided by `format-number.ts`.
 *
 * TIE DIRECTION is HALF-AWAY-FROM-ZERO (ledger **V8**): `round(-0.5)` is `-1`,
 * `round(-2.5)` is `-3`, `round(-1.55, 1)` is `-1.6`. That is Less 4.x `round()`
 * (`toFixed`) and dart-sass `math.round`, and it keeps `round(-x) === -round(x)`.
 * `Math.round` alone would send a negative half toward `+infinity`.
 */
const roundHalf = (n: number): number => (n < 0 ? -Math.round(-n) : Math.round(n));

/** The decimal places a precision rounds to. */
const places = (precision: number): number => precision < 0 ? 0 : precision > 292 ? 292 : Math.trunc(precision);

/** The CSS `round()` step those decimal places are (css-values-4 §10.3). */
export const decimalStep = (precision = 0): number => 10 ** -places(precision);

export function round(number: number, precision?: number): number {
  if (precision === undefined) {
    return roundHalf(number);
  }
  const p = places(precision);
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
