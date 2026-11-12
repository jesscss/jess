/**
 * `+ - * / %` on two numbers, with `+ - * %` in base 10 (big.js). Its own
 * module, so a bundle that never does arithmetic on a number drops big.js.
 */
import Big from 'big.js';

/**
 * Scalar arithmetic for dimension operands — the one choke point for `+ - * / %`
 * in the AST-v2 engine.
 *
 * `+`, `-` and `*` run in EXACT BASE 10. A CSS author writes decimals; IEEE-754
 * stores binary, and a terminating decimal such as `0.1` or `0.33333333333333`
 * is a repeating binary fraction. Chained arithmetic then accumulates that error
 * and, when it subtracts near-equal quantities, cancels away the significant
 * digits — `1 - 0.33333333333333` three times lands 1.2% away from the true
 * decimal `1e-14`. Every one of those float subtractions is correctly rounded
 * (measured: 0 ulp error per step), so the loss is the BASE, not the operation,
 * and no reassociation recovers it.
 *
 * This is NOT a rounding step. Ledger **V5** forbids quantizing at construction
 * because it compounds; **V4** puts the sole quantization at output
 * (`formatNumber`, shortest decimal within 1e-10 relative). Exact arithmetic
 * REMOVES error rather than introducing it, and leaves the output policy alone.
 *
 * `/` DELIBERATELY STAYS ON FLOAT, and this is a correctness decision rather
 * than a performance one. big.js `div` rounds to `Big.DP` DECIMAL PLACES (20 by
 * default), not significant digits, so it under-resolves small magnitudes:
 * `1e-15 / 3` gives `3.3333e-16` (5 significant digits) where float gives
 * `3.3333333333333336e-16` (17). Routing division through it would make jess
 * LESS accurate for exactly the small magnitudes this work is about — the same
 * class of mistake as the 8-decimal-place floor removed in `f42decf7f` /
 * `137cfa8fa`, which annihilated colour magnitudes below ~5e-9. No fixed `DP`
 * fixes it: `DP` is absolute and magnitudes are not. There is also nothing to
 * preserve — a quotient of terminating decimals is generally non-terminating, so
 * unlike `+ - *` there is no exact decimal answer being thrown away.
 *
 * Operands arrive as `number`. Constructing the `Big` from the parsed double is
 * exact and needs no source-text plumbing: `String(double)` is the SHORTEST
 * round-tripping decimal (verified: 0 failures in 200k random doubles), so it
 * recovers the authored decimal for any literal a double can represent, and
 * `Big(0.33333333333333)` and `Big('0.33333333333333')` are the same value.
 */
export function calculate(a: number, op: string, b: number): number {
  switch (op) {
    case '+': return exact(a, b, ADD, a + b);
    case '-': return exact(a, b, SUB, a - b);
    case '*': return exact(a, b, MUL, a * b);
    case '/': return a / b;
    case '%': return exact(a, b, MOD, a % b);
  }
  throw new TypeError(`Unknown operator ${op}`);
}

const ADD = 0, SUB = 1, MUL = 2, MOD = 3;

/**
 * Run one exact base-10 operation, falling back to the already-computed float
 * result when either operand is non-finite (big.js throws on NaN/Infinity, and a
 * numeric oddity must not become a hard error) or when the operands are integers
 * — integers below 2^53 are exact in a double already, so base 10 buys nothing.
 */
function exact(a: number, b: number, kind: number, fallback: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return fallback;
  }
  if (Number.isSafeInteger(a) && Number.isSafeInteger(b)) {
    return fallback;
  }
  const x = new Big(String(a));
  const y = new Big(String(b));
  switch (kind) {
    case ADD: return Number(x.plus(y));
    case SUB: return Number(x.minus(y));
    case MUL: return Number(x.times(y));
    default: return Number(x.mod(y));
  }
}
