/**
 * The OUTPUT number policy: how a COMPUTED number becomes the digits written into
 * a stylesheet. One policy for every computed number, whatever position it lands in
 * — declaration value, interpolation splice, property name, selector, color channel.
 *
 * NOT a precision limiter. `String(n)` is already shortest-round-trip (Steele-White
 * class), so it is obliged to print `0.30000000000000004` for `0.1 + 0.2`: that IS a
 * different double from `0.3`. What it cannot do is drop digits that are only the
 * residue of binary floating point. So this is the TOLERANCE-AWARE variant: emit the
 * shortest decimal lying within {@link TOLERANCE} relative of the computed double.
 *
 * There is deliberately NO significant-figure cap and no per-unit policy. A cap buys
 * 0.077% of corpus bytes while destroying real digits at magnitude >= 10
 * (`393.35275591px` -> `393.35276px`), and CSS Values 4 §5 leaves numeric precision
 * explicitly implementation-defined, so nothing forces one.
 *
 * Source literals are NOT routed here — an un-operated `1.50000px` / `2PX` keeps its
 * verbatim spelling (`literal-tag.ts`).
 */

/**
 * Relative tolerance. A candidate is accepted when `|candidate - n| <= |n| * 1e-10`.
 * Magnitude-invariant, ~100x tighter than an 8-significant-figure cap, and the only
 * tolerance whose literals stay SHORTER than the previous 8-decimal-place output for
 * values >= 10. Unlike a decimal-place floor it never annihilates a small magnitude:
 * 8 dp flattened everything below ~5e-9 to literally `0`.
 */
const TOLERANCE = 1e-10;

/**
 * Significant-digit short-circuit. A relative tolerance of 1e-10 can only ever
 * shorten a value carrying MORE than 10 significant digits; at or below that the
 * shortest-round-trip form is already the shortest form within tolerance, so the
 * search cannot improve on it.
 *
 * Free, because {@link formatNumber} has to build `String(n)` anyway — the count is a
 * charCode scan over a string we already hold, with no allocation. Verified against
 * the ungated search over 2,000,000 mixed random doubles plus 2,900,927 focused
 * 9-and-10-significant-digit doubles spanning 1e-20..1e19: zero mismatches. A gate of
 * 11 is NOT sound (`-86731.985251` shortens to `-86731.98525`).
 */
const SIG_DIGIT_GATE = 10;

/** Longest decimal a double needs to round-trip. */
const MAX_PRECISION = 17;

/**
 * Serialize a computed number to CSS digits: shortest decimal within {@link TOLERANCE}
 * relative of `n`, never in scientific notation.
 *
 * A NON-FINITE computed number has no CSS spelling and is an EVALUATION ERROR (ledger
 * **V7**) — `NaN`, `infinity` and `-infinity` are not `<number>` productions, so
 * emitting them writes a stylesheet the browser drops. This is the one boundary every
 * computed number crosses, so the guard is stated once here rather than per-function:
 * `sqrt(-4)`, `asin(2)`, `pow(-1, .5)`, `mod(1, 0)` and `1e400 + 1` all reach output
 * through this call. The check is free — a non-finite double is never an integer, so
 * the fast path above has already returned for every value a stylesheet really holds.
 *
 * Un-operated source literals are NOT routed here, so `x: 1e999px` still emits its
 * verbatim spelling under ledger V1.
 */
export function formatNumber(n: number): string {
  const s = `${n}`;

  /*
   * An exactly-representable integer carries no float noise, so there is nothing for
   * the tolerance to remove — and applying it anyway would CHANGE a precise value
   * (`123456789012` -> `123456789000`). Also the common case: half of what a
   * stylesheet emits is a small integer.
   */
  if (Number.isInteger(n)) {
    return s.indexOf('e') === -1 ? s : positional(s);
  }
  if (!Number.isFinite(n)) {
    throw new RangeError(`${s} is not a finite number and has no CSS spelling`);
  }
  let sig = 0;
  let seenDigit = false;
  let exponential = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x65 /* e */) {
      exponential = true;
      break;
    }
    if (c >= 0x31 /* 1 */ && c <= 0x39 /* 9 */) {
      seenDigit = true;
      sig++;
    } else if (c === 0x30 /* 0 */ && seenDigit) {
      sig++;
    }
  }
  if (sig <= SIG_DIGIT_GATE) {
    return exponential ? positional(s) : s;
  }
  const tolerance = Math.abs(n) * TOLERANCE;
  for (let p = 1; p <= MAX_PRECISION; p++) {
    const candidate = Number(n.toPrecision(p));
    if (Math.abs(candidate - n) <= tolerance) {
      const t = `${candidate}`;
      return t.indexOf('e') === -1 ? t : positional(t);
    }
  }
  return exponential ? positional(s) : s;
}

/**
 * Expand a `String(n)` exponent form to positional decimal. CSSOM §6.7.2 on
 * serializing a `<number>`: "scientific notation is not used" — and `<length>` /
 * `<percentage>` are defined by reference to `<number>`, so this reaches them.
 *
 * `String` switches to exponent form at |n| >= 1e21 and |n| < 1e-6, so this is
 * unreachable for anything a stylesheet plausibly holds; it exists so the guard is
 * EXPLICIT rather than emergent. It became reachable at all only when the 8-dp floor
 * went away: every value in (0, 5e-9) used to flatten to `0`.
 */
function positional(s: string): string {
  const e = s.indexOf('e');
  if (e === -1) {
    return s;
  }
  const exponent = Number(s.slice(e + 1));
  let mantissa = s.slice(0, e);
  let sign = '';
  if (mantissa.charCodeAt(0) === 0x2d /* - */) {
    sign = '-';
    mantissa = mantissa.slice(1);
  }
  const dot = mantissa.indexOf('.');
  let digits = mantissa;
  let fractionLen = 0;
  if (dot !== -1) {
    digits = mantissa.slice(0, dot) + mantissa.slice(dot + 1);
    fractionLen = mantissa.length - dot - 1;
  }

  // value === digits * 10^shift
  const shift = exponent - fractionLen;
  if (shift >= 0) {
    return `${sign}${digits}${'0'.repeat(shift)}`;
  }
  const point = digits.length + shift;
  if (point > 0) {
    return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return `${sign}0.${'0'.repeat(-point)}${digits}`;
}
