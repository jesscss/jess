/**
 * Lean number rounding, inlined from lodash `round`.
 *
 * lodash's `round` routes through a `createRound` closure plus generic
 * `toNumber`/`toInteger`/`toString` coercion helpers on every call. Every
 * Dimension/Color serialize and every color-channel clamp hits it, so on
 * value-heavy input the generic machinery is pure overhead — our inputs are
 * always finite `number`s with a literal precision.
 *
 * This replicates lodash's exponential-shift algorithm EXACTLY (same
 * `Math.round`, same `${n}e`.split('e') string dance) so output is
 * byte-identical, minus the generic coercion. An integer fast-path skips the
 * string work for the common case (the shift is a no-op for integers).
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

export default round;
