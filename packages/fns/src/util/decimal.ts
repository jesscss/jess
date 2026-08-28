/**
 * Exact base-10 add / subtract / multiply for the ACCUMULATING colour channels.
 *
 * WHY THIS EXISTS. A CSS author writes decimals; IEEE-754 stores binary. A
 * terminating decimal such as `0.33333333333333` is a REPEATING binary fraction,
 * so `alpha - amount` is already approximate before any chaining, and a chain of
 * fades then subtracts near-equal quantities and cancels away the significant
 * digits:
 *
 *   fadeout(fadeout(fadeout(#f00, 33.333333333333%), …), …)
 *     float   -> 9.880984919163893e-15   (1.2% wrong)
 *     decimal -> 1e-14                   (the exact answer)
 *
 * Every subtraction in that float chain is CORRECTLY ROUNDED (measured: 0 ulp
 * error at each step). The loss is not a mistake in the operation, it is the
 * base — which is why no reassociation or reformulation of the float arithmetic
 * recovers it, and why the fix is the number base rather than the operand order.
 *
 * THIS IS NOT A ROUNDING STEP. Ledger row **V5** (`DESIGN-DECISIONS.md`) forbids
 * quantizing a colour channel at construction because it compounds through
 * chained colour math; row **V4** puts the sole quantization at the output
 * boundary (`formatNumber`, shortest decimal within 1e-10 relative). Exact
 * decimal arithmetic is the OPPOSITE of a construction-time round: it removes
 * error instead of introducing it, and leaves the output policy untouched.
 *
 * SCOPE — deliberately narrow. These helpers make a result exact only when the
 * OPERANDS are terminating decimals. That holds for alpha (`1`, an authored
 * literal, or a previous exact result) and for an authored percentage. It does
 * NOT hold for an HSL channel, which `colorHsl` derives as `rgb/255` —
 * `128/255 = 0.5019607843137255…` does not terminate in base 10 either (255 has
 * the prime factor 17). Routing `lighten`/`darken`/`saturate`/`desaturate`/
 * `spin` through big.js would relocate their rounding, not remove it, so they
 * are deliberately left on float. See the fns README note.
 *
 * Only `plus` / `minus` / `times` are used: in big.js these are unbounded and
 * exact. `div` is NOT used — it rounds to `Big.DP` (default 20) — so
 * `percentToFraction` multiplies by `0.01` rather than dividing by `100`.
 *
 * Values round-trip back to `number` because `Color.alpha` is a `number`. That
 * is lossless for this purpose: `String(double)` is the SHORTEST round-tripping
 * decimal, so re-reading a stored alpha recovers the exact decimal the previous
 * call produced (verified for the fade chain — the intermediates `0.66666666666667`
 * and `0.33333333333334` survive the round-trip unchanged). No change to the
 * numeric storage model is therefore required.
 */
import Big from 'big.js';

/**
 * `Big` from a `number` via its shortest round-tripping decimal string. Built
 * from `String(n)` rather than handing `Big` the raw number so the result cannot
 * depend on a global `Big.strict` set by some other consumer of the library.
 */
const big = (n: number): Big => new Big(String(n));

/** Guard: `Big` throws on NaN/Infinity, and a numeric oddity must not become a hard error. */
const usable = (...ns: number[]): boolean => ns.every(n => Number.isFinite(n));

/** Exact `a + b` in base 10, falling back to float for non-finite input. */
export function addExact(a: number, b: number): number {
  return usable(a, b) ? Number(big(a).plus(big(b))) : a + b;
}

/** Exact `a - b` in base 10, falling back to float for non-finite input. */
export function subExact(a: number, b: number): number {
  return usable(a, b) ? Number(big(a).minus(big(b))) : a - b;
}

/** Exact `a * b` in base 10, falling back to float for non-finite input. */
export function mulExact(a: number, b: number): number {
  return usable(a, b) ? Number(big(a).times(big(b))) : a * b;
}

/**
 * Exact `n / 100` — the percentage-to-fraction conversion every alpha fn does on
 * its authored amount. Multiplies by `0.01` because big.js `div` rounds to
 * `Big.DP` while `times` is exact.
 */
export function percentToFraction(n: number): number {
  return usable(n) ? Number(big(n).times('0.01')) : n / 100;
}
