/**
 * Exact base-10 `+`, `-`, `*` and `%` on doubles (ledger V6), on native `BigInt`.
 *
 * A CSS author writes decimals and a double stores binary, so `0.33333333333333`
 * is already approximate and a chain of subtractions cancels away its digits:
 * three `fadeout(…, 33.333333333333%)` land on 9.88e-15 in float, 1e-14 here.
 *
 * A double is read as the decimal `String(n)` spells, its SHORTEST round-trip,
 * which recovers the authored literal. That decimal is `digits × 10^-places`.
 * `+ - * %` of two such decimals is exact; `Number()` of the exact result's text
 * is the correctly rounded double. Integer operands skip all of it: below 2^53 a
 * double is already exact, and float `+ - *` is correctly rounded, so the
 * answer is the same.
 *
 * `/` is not here, by V6: a quotient of terminating decimals rarely terminates.
 */

/** `[digits, places]`: the value `digits × 10^-places`, with `places >= 0`. */
type Decimal = [bigint, number];

const decimal = (n: number): Decimal => {
  const text = String(n);
  const e = text.indexOf('e');
  const mantissa = e < 0 ? text : text.slice(0, e);
  const dot = mantissa.indexOf('.');
  const places = (dot < 0 ? 0 : mantissa.length - dot - 1) - (e < 0 ? 0 : Number(text.slice(e + 1)));
  const digits = BigInt(dot < 0 ? mantissa : mantissa.slice(0, dot) + mantissa.slice(dot + 1));
  return places < 0 ? [digits * 10n ** BigInt(-places), 0] : [digits, places];
};

const toNumber = (digits: bigint, places: number): number => Number(places === 0 ? String(digits) : `${digits}e-${places}`);

const at = ([digits, from]: Decimal, places: number): bigint => from === places ? digits : digits * 10n ** BigInt(places - from);

/** Whether the base-10 path is needed: both finite, not both exact integers. */
const decimalPath = (a: number, b: number): boolean =>
  Number.isFinite(a) && Number.isFinite(b) && !(Number.isSafeInteger(a) && Number.isSafeInteger(b));

const aligned = (a: number, b: number, combine: (x: bigint, y: bigint) => bigint): number => {
  const x = decimal(a);
  const y = decimal(b);
  const places = Math.max(x[1], y[1]);
  return toNumber(combine(at(x, places), at(y, places)), places);
};

/** Exact `a + b`. */
export const addExact = (a: number, b: number): number => decimalPath(a, b) ? aligned(a, b, (x, y) => x + y) : a + b;

/** Exact `a - b`. */
export const subExact = (a: number, b: number): number => decimalPath(a, b) ? aligned(a, b, (x, y) => x - y) : a - b;

/** Exact `a % b`, the sign of `a` as in JS. A zero divisor gives `NaN`, as float does. */
export const modExact = (a: number, b: number): number => decimalPath(a, b) && b !== 0 ? aligned(a, b, (x, y) => x % y) : a % b;

/** Exact `a * b`. */
export const mulExact = (a: number, b: number): number => {
  if (!decimalPath(a, b)) {
    return a * b;
  }
  const [x, xp] = decimal(a);
  const [y, yp] = decimal(b);

  /* A zero product keeps float's sign (`-2.5 * 0` is `-0`); `BigInt` has no `-0`. */
  return x === 0n || y === 0n ? a * b : toNumber(x * y, xp + yp);
};

/** Exact `n / 100`, a percentage as a fraction. */
export const percentToFraction = (n: number): number => {
  if (!Number.isFinite(n) || Number.isSafeInteger(n)) {
    return n / 100;
  }
  const [digits, places] = decimal(n);
  return toNumber(digits, places + 2);
};
