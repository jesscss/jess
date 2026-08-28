/**
 * SYNCHRONOUS value arithmetic for the value domain: dimension/color math and the
 * binary `operate`. Dimension math is a faithful port of less.js `Dimension.operate`
 * — cross-unit `*`/`/` compose + cancel the numerator/denominator multiset, `+`/`-`
 * unify a compatible RHS (raw magnitudes otherwise), keeping the LHS unit; only
 * `strict` throws. The `operate` seam adds the calc-splice + unoperable-keyword
 * preserve guards, plus a preserve-mode `calc()` fallback for a color-op clash.
 * Guard comparison / type-predicates live in `value-guards.ts`.
 *
 * HARD MODULE BOUNDARY: imports only the value domain, the factory, and the shared
 * units table.
 */
import Big from 'big.js';
import { UnitArithmeticError, isValueGroupArray, type Color, type Dimension, type EvalModes, type ValueGroup, type Value } from './value-eval.js';
import { HEX } from './color.js';
import { colorRawRgb, makeColorRgb, makeCompoundDimension, makeDimension, makeKeyword } from './value-factory.js';
import { coerceNamedColorKeyword } from './literal-tag.js';
import { convertValue } from './value-units.js';

/* --------------------------------------------------------- arithmetic */

/*
 * Re-exported, not defined here: comparison raises the same error for the same
 * defect (`2px > 1em`), and `value-guards.ts`'s module boundary does not admit
 * this module. The class lives in the value domain both import. See its JSDoc.
 */
export { UnitArithmeticError } from './value-eval.js';

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
function calculate(a: number, op: string, b: number): number {
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

/* ---------------------------------------------------------- color math */

/** Color arithmetic: color ⊕ dimension (per-channel scalar) or color ⊕ color (per-channel + alpha compositing). */
function colorOperate(a: Color, b: Value, op: string): Color {
  const aRGB = colorRawRgb(a);
  let newAlpha = a.alpha;
  let out: [number, number, number];
  if (b.type === 'Dimension') {
    /*
     * less.js `Dimension.toColor` treats the magnitude as a per-channel scalar and
     * IGNORES the unit (`#ff0000 + 10px` → `#ff0a0a`), so no unit clash here.
     */
    out = [calculate(aRGB[0], op, b.number), calculate(aRGB[1], op, b.number), calculate(aRGB[2], op, b.number)];
  } else if (b.type === 'Color') {
    const bRGB = colorRawRgb(b);
    out = [calculate(aRGB[0], op, bRGB[0]), calculate(aRGB[1], op, bRGB[1]), calculate(aRGB[2], op, bRGB[2])];
    newAlpha = a.alpha * (1 - b.alpha) + b.alpha;
  } else {
    throw new TypeError(`Cannot operate on ${b.type}`);
  }

  /*
   * An OPERATED color is a fresh canonical result: less.js `Color.operate` yields a
   * bare rgb color with no source spelling, so it emits as HEX regardless of the
   * operands' authored `rgb()`/`hsl()` format (the verbatim rule preserves only
   * UN-operated literals). Drop `format`/`modernSyntax` → canonical `#rrggbb`.
   */
  return makeColorRgb(out, newAlpha, HEX);
}

/* ------------------------------------------------------ unit multiset */

/** A dimension's unit as a numerator/denominator multiset + `backupUnit` (less.js `Unit`). */
interface UnitSet {
  num: string[];
  den: string[];
  backup: string | undefined;
}

/** Read a dimension's unit multiset — the stored compound set, or `[unit]/[]` for a plain unit. */
function unitsOf(d: Dimension): UnitSet {
  if (d.numerator) {
    return { num: d.numerator.slice(), den: (d.denominator ?? []).slice(), backup: d.backupUnit };
  }
  return { num: d.unit ? [d.unit] : [], den: [], backup: d.unit || undefined };
}

/** less.js `Unit.cancel`: remove numerator/denominator units that appear on both sides. */
function cancel(u: UnitSet): void {
  const counter = new Map<string, number>();
  for (const n of u.num) {
    counter.set(n, (counter.get(n) ?? 0) + 1);
  }
  for (const d of u.den) {
    counter.set(d, (counter.get(d) ?? 0) - 1);
  }
  const num: string[] = [];
  const den: string[] = [];
  for (const [unit, count] of counter) {
    for (let i = 0; i < count; i++) {
      num.push(unit);
    }
    for (let i = 0; i < -count; i++) {
      den.push(unit);
    }
  }
  u.num = num.sort();
  u.den = den.sort();
}

/**
 * Compose `b`'s unit multiset into `a`'s under `*` or `/`, then cancel — the
 * shared half of `*`/`/` unit arithmetic.
 */
function composeUnits(u: UnitSet, bu: UnitSet, op: string): void {
  if (op === '*') {
    u.num = u.num.concat(bu.num);
    u.den = u.den.concat(bu.den);
  } else {
    u.num = u.num.concat(bu.den);
    u.den = u.den.concat(bu.num);
  }
  cancel(u);
}

/**
 * Whether a composed unit set has a CSS spelling. Exactly two shapes do: one
 * surviving numerator unit (`4em / 2cm` → `em`), and the empty set, which is a
 * genuine unitless number (`2px / 1px` → `2`). Anything else — a unit PRODUCT
 * (`px·px`, `px·%`) or a bare reciprocal (`px⁻¹`) — has no CSS unit at all, and
 * naming one means fabricating it out of `backupUnit` or a denominator.
 */
function expressible(u: UnitSet): boolean {
  return u.num.length === 1 || (u.num.length === 0 && u.den.length === 0);
}

/**
 * less.js `Unit.genCSS` display rule: a singular numerator emits that unit;
 * else the `backupUnit`; else the first denominator; else empty (a pure number).
 * Strict-mode singularity is validated only when the final value is consumed;
 * intermediate compound units must remain available for a later operation to
 * cancel. A fully cancelled result is a unitless number in EVERY mode even when
 * its intermediate `backupUnit` was authored (`2px / 1px` → `2`, §4 row g2):
 * like units cancelling is the one composition that is honestly expressible, so
 * reaching for the backup there would re-attach a unit the value no longer has.
 */
function displayUnit(u: UnitSet): string {
  if (u.num.length === 1) {
    return u.num[0]!;
  }
  if (u.num.length === 0 && u.den.length === 0) {
    return '';
  }
  if (u.backup) {
    return u.backup;
  }
  if (u.den.length) {
    return u.den[0]!;
  }
  return '';
}

/**
 * Validate unit singularity at a final typed-value boundary. Arithmetic keeps
 * compound numerator/denominator facts through the whole operation chain so a
 * later operation can cancel them; only final materialization/emission applies
 * the singularity rule.
 *
 * `demandExpressible` raises the rule ABOVE `unitMode`, for a value produced at
 * a boundary that is itself a demand for an expressible result. `unitMode` is a
 * LESS-COMPAT lever (`.less` decides between Less 4.x's dimensionally false fold,
 * a preserved `calc(…)`, and an error); a construct that means "compute this and
 * give me the value" has no such choice to offer, because there is no value to
 * give when the result has no CSS spelling. See {@link Expression}.
 */
export function validateFinalUnits(value: ValueGroup, modes: EvalModes, demandExpressible = false): void {
  if (!demandExpressible && modes.unitMode !== 'strict') {
    return;
  }
  if (isValueGroupArray(value)) {
    for (const item of value) {
      validateFinalUnits(item, modes, demandExpressible);
    }
    return;
  }
  if (value.type === 'Dimension') {
    const numerator = value.numerator ?? (value.unit ? [value.unit] : []);
    const denominator = value.denominator ?? [];
    if (numerator.length > 1 || denominator.length > 0) {
      throw new UnitArithmeticError('Multiple units in dimension. Correct the units or use the unit function');
    }
    return;
  }
  if (value.type === 'List') {
    for (const item of value.value) {
      validateFinalUnits(item, modes, demandExpressible);
    }
    return;
  }
  if (value.type === 'Block') {
    validateFinalUnits(value.value, modes, demandExpressible);
  }
}

/**
 * Unit-aware dimension arithmetic (dimension ⊕ dimension) — a faithful port of
 * less.js `Dimension.operate`: `+`/`-` unify the RHS to the LHS unit (raw magnitudes
 * when non-convertible), `*`/`/` compose the numerator/denominator multiset and
 * cancel. Only `strict` throws on a non-singular result; loose/preserve always
 * compute, keeping the LHS unit (`4em / 2cm` → `2em`, `8cats * 9dogs / 4cats` → `18dogs`).
 */
function dimensionOperate(a: Dimension, b: Dimension, op: string, modes: EvalModes): Dimension {
  const isStrict = modes.unitMode === 'strict';
  if (b.number === 0 && op === '/') {
    throw new TypeError('Cannot divide by zero');
  }

  const u = unitsOf(a);
  const bu = unitsOf(b);
  let value = calculate(a.number, op, b.number);

  if (op === '+' || op === '-') {
    if (u.num.length === 0 && u.den.length === 0) {
      // Unitless LHS: adopt the RHS unit (keeping the LHS backup if it had one).
      u.num = bu.num;
      u.den = bu.den;
      u.backup = u.backup ?? bu.backup;
    } else if (bu.num.length === 0 && u.den.length === 0) {
      // Unitless RHS: keep the LHS unit; value already computed on raw magnitudes.
    } else {
      // Both carry units: convert the RHS toward the LHS unit before operating.
      const target = u.num[0] ?? u.den[0] ?? '';
      const from = bu.num[0] ?? bu.den[0] ?? '';
      const bVal = convertValue(b.number, from, target);
      if (isStrict && bVal === b.number && from !== target) {
        throw new UnitArithmeticError(`Incompatible units. Change the units or use the unit function. Bad units: '${target}' and '${from}'.`);
      }
      value = calculate(a.number, op, bVal);
    }
  } else if (op === '*' || op === '/') {
    composeUnits(u, bu, op);
  }

  const unit = displayUnit(u);

  /*
   * Persist the multiset only when it isn't a plain single numerator (so chained
   * ops can still cancel); a singular/empty unit round-trips through `makeDimension`.
   *
   * An expressible result NEVER carries a preserved spelling, which is what lets
   * a chain come back from an unexpressible intermediate: `1px * 1px` has no CSS
   * unit and preserves, then `/ 1px` cancels the multiset to a plain `px` and the
   * value is spelled `1px` again. Dropping the spelling here is the whole reason
   * the ladder can afford to keep computing.
   */
  if (u.num.length === 1 && u.den.length === 0) {
    return makeDimension(value, unit);
  }
  return makeCompoundDimension(value, unit, u.num, u.den, u.backup,
    modes.unitMode === 'preserve' && !expressible(u) ? preservedSpelling(a, op, b) : undefined);
}

/**
 * The authored expression for a preserved result, in AUTHORED OPERAND ORDER
 * (`10% * 1px` stays `10% * 1px`; dart-sass reorders it, we do not).
 *
 * An operand that is itself preserved contributes its own spelling rather than
 * its bytes, which is what flattens a chain into ONE expression
 * (`(1.4em * 14px) * 10cm` → `1.4em * 14px * 10cm`) instead of nesting `calc()`
 * inside `calc()`. CSS flattens nested calc anyway, so the flat form is also the
 * one CSS would have produced.
 */
function preservedSpelling(a: Dimension, op: string, b: Dimension): string {
  return `${a.preserved ?? a.bytes} ${op} ${b.preserved ?? b.bytes}`;
}

/** Dimension ⊕ Color: coerce the dimension to a color (unit ignored, per less.js
 * `Dimension.toColor`), then color-operate. `10px + #ff0000` → `#ff0a0a`. */
function dimensionAsColor(a: Dimension, b: Color, op: string): Color {
  /*
   * `thisColor.format` is inert (colorOperate reads only its channels and always
   * returns a canonical HEX result), so build it as a plain HEX color.
   */
  const thisColor = makeColorRgb([a.number, a.number, a.number], 1, HEX);
  return colorOperate(thisColor, b, op);
}

/* -------------------------------------------------------- calc guards */

/**
 * A single `calc(...)` wrapper: the capture group is its inner expression.
 * Calc-keyword operands are always singly wrapped (guard 1 fires before guard 2
 * whenever both sides are calc, and the unit-clash fallback wraps a single
 * composed operation), so the greedy capture never mis-splits a composed
 * `calc(a) + calc(b)`.
 */
const CALC_WRAP_RE = /^calc\(([\s\S]*)\)$/;

/**
 * If `bytes` is a `calc(...)` wrapper, return its inner expression; otherwise
 * `null`. CSS flattens nested calc, so a `calc(...)` operand composing into an
 * outer operation has its inner expression spliced in directly, yielding one flat
 * `calc(...)` rather than `calc(calc(...) op Y)`. A paren-delimited Block-wrapped inner
 * expression keeps its paren (`calc((a - b))` -> `(a - b)`).
 *
 */
export const calcInner = (bytes: string): string | null => {
  const m = CALC_WRAP_RE.exec(bytes.trim());
  return m ? m[1]! : null;
};

/**
 * Whether `s` is a single fully-parenthesized group (`(a - b)`), so its leading
 * `(` closes only at the final `)`. Used so a spliced calc operand keeps ONE
 * paren layer (`calc((a - b)) + 1` → `(a - b)`) and is not re-wrapped.
 */
function isParenGroup(s: string): boolean {
  if (s.length < 2 || s[0] !== '(' || s[s.length - 1] !== ')') {
    return false;
  }
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') {
      depth++;
    } else if (s[i] === ')' && --depth === 0) {
      return i === s.length - 1;
    }
  }
  return false;
}

/**
 * A calc operand's inner expression, parenthesized when it is a bare composite
 * (`2.25rem + 2px` → `(2.25rem + 2px)`) so precedence survives the splice into an
 * outer operation; an already-parenthesized or single-term inner is spliced as-is.
 * Preserved bytes always separate a top-level operator with surrounding spaces.
 */
function spliceInner(inner: string): string {
  if (isParenGroup(inner)) {
    return inner;
  }
  const hasAdditive = / [-+] /.test(inner);

  /*
   * Keep an additive nested calc as one authored computation when it is spliced
   * into another operation. CSS can flatten the wrapper, but Less retains this
   * grouping (`calc(2.25rem + 2px) - 2px` → `(2.25rem + 2px) - 2px`).
   */
  if (hasAdditive) {
    return `(${inner})`;
  }
  return inner;
}

/**
 * less.js calc math: inside `calc(…)` only a "safe" dimension op computes — a
 * same-unit `+`/`-`, a `*` with a unitless side, or a `/` with a unitless RHS.
 * A cross-unit op is preserved verbatim as a `calc(…)` sub-expression.
 */
function calcSafe(op: string, a: Dimension, b: Dimension): boolean {
  if (op === '+' || op === '-') {
    return a.unit === b.unit;
  }
  if (op === '*') {
    return !a.unit || !b.unit;
  }
  if (op === '/') {
    return !b.unit;
  }
  return true;
}

/**
 * Binary operation. Guard order (byte-faithful):
 *   1. a `calc(...)` keyword operand → splice its inner expression (flat calc),
 *   2. an un-operable keyword operand → preserve source `l op r`,
 *   3. inside `calc(…)`, a cross-unit dimension op → flat `calc(l op r)`,
 *   4. a §4.7 unexpressible unit composition in `preserve` mode → `calc(l op r)`,
 *   5. else direct arithmetic; a unit-clash `TypeError` in `preserve` mode →
 *      `calc(l op r)` fallback.
 */
export function operate(op: string, left: Value, right: Value, modes: EvalModes): Value {
  /*
   * Guard 1: calc-wrapper keyword operand → flat calc splice.
   * byte-faithful: opaque operand, no structured node — at the seam a calc
   * operand is always an already-materialized keyword (the structured `calc(...)`
   * FunctionCall was folded to bytes upstream), and a computed preserve-mode
   * `calc(...)` fallback result has no node at all, so both are string-unwrapped.
   */
  /*
   * [null] `null` is ABSENT, not an operand: it contributes nothing and the other
   * side stands (§4.3, measured on dart-sass 1.101.0 — `b: 1 + null` is `b: 1`).
   * Two nulls stay null. This sits ABOVE the calc/keyword guards so `null` never
   * gets spliced into a preserved `calc(…)` as the bare text `null`.
   */
  if (left.type === 'Null') {
    return right;
  }
  if (right.type === 'Null') {
    return left;
  }

  /*
   * NamedColor→Keyword convergence: an arithmetic operand that is a named-color
   * keyword (`red`) is a color HERE, at the point of use. This restores less's
   * `red + #111` → `#ff1111`, `red * 2` → `#ff0000`, `(red / 2)` → `#800000`, and
   * bare `red / 2` under `math: always` → `#800000` (the bare-slash promotion in
   * serialize.ts admits the named-color leaf, then this fold runs) — matching hex
   * colors and lessc 4.x. A non-color keyword still hits the preserve guard below.
   * Coercion runs before the calc/keyword guards so the color operand reaches
   * `colorOperate` instead of being preserved as bytes. See DESIGN-DECISIONS V13.
   */
  left = coerceNamedColorKeyword(left);
  right = coerceNamedColorKeyword(right);

  const leftInner = left.type === 'Keyword' ? calcInner(left.bytes) : null;
  const rightInner = right.type === 'Keyword' ? calcInner(right.bytes) : null;
  if (leftInner !== null || rightInner !== null) {
    const lb = leftInner !== null ? spliceInner(leftInner) : left.bytes;
    const rb = rightInner !== null ? spliceInner(rightInner) : right.bytes;
    return makeKeyword(`calc(${lb} ${op} ${rb})`);
  }

  // Guard 2: an un-operable keyword operand → preserve source.
  if (left.type === 'Keyword' || right.type === 'Keyword') {
    return makeKeyword(`${left.bytes} ${op} ${right.bytes}`);
  }

  /*
   * Guard 3: inside calc, a cross-unit dimension op does NOT collapse on raw
   * magnitudes — it is preserved as a flat `calc(l op r)` sub-expression.
   */
  if (modes.inCalc && left.type === 'Dimension' && right.type === 'Dimension'
    && !calcSafe(op, left, right)) {
    return makeKeyword(`calc(${left.bytes} ${op} ${right.bytes})`);
  }

  /*
   * §4.7's ladder is deliberately NOT a guard here. `preserve` governs how an
   * UNEXPRESSIBLE RESULT IS SPELLED, not whether the arithmetic happens — an
   * operated value must compute in every mode, and `dimensionOperate` is what
   * computes it. Declining the operation here instead (returning an opaque
   * `calc(…)` keyword) discarded the magnitude and the unit multiset at the first
   * unexpressible INTERMEDIATE, so `1px * 1px / 1px` could never cancel back to
   * `1px`, `8cats * 9dogs / 4cats` could never reach `18dogs`, and `unit()` — a
   * function whose entire job is to read the magnitude and replace the unit — got
   * a keyword it had to decline, emitting `unit(calc(…))` into the stylesheet.
   *
   * The three rungs part company on the RESULT: `loose` fabricates a unit from
   * `backupUnit`, `preserve` carries the authored spelling (`Dimension.preserved`),
   * and `strict` carries neither, so `validateFinalUnits` rejects the non-singular
   * unit at the consuming boundary. One computation, three spellings.
   */
  try {
    if (left.type === 'Dimension' && right.type === 'Dimension') {
      return dimensionOperate(left, right, op, modes);
    }
    if (left.type === 'Dimension' && right.type === 'Color') {
      return dimensionAsColor(left, right, op);
    }
    if (left.type === 'Color') {
      return colorOperate(left, right, op);
    }
    throw new TypeError(`Cannot operate on ${left.type}`);
  } catch (err) {
    if (err instanceof TypeError && modes.unitMode === 'preserve') {
      return makeKeyword(`calc(${left.bytes} ${op} ${right.bytes})`);
    }
    throw err;
  }
}
