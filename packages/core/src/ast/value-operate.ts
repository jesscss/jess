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
import type { Color, Dimension, EvalModes, ValueObj } from './value-eval.js';
import { colorRawRgb, makeColorRgb, makeCompoundDimension, makeDimension, makeKeyword } from './value-factory.js';
import { convertValue } from './value-units.js';

/* --------------------------------------------------------- arithmetic */

function calculate(a: number, op: string, b: number): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return a / b;
    case '%': return a % b;
  }
  throw new TypeError(`Unknown operator ${op}`);
}

/* ---------------------------------------------------------- color math */

/** Color arithmetic: color ⊕ dimension (per-channel scalar) or color ⊕ color (per-channel + alpha compositing). */
function colorOperate(a: Color, b: ValueObj, op: string, modes: EvalModes): Color {
  const aRGB = colorRawRgb(a);
  let newAlpha = a.alpha;
  let out: [number, number, number];
  if (b.type === 'Dimension') {
    const isStrictLike = modes.unitMode === 'strict' || modes.unitMode === 'preserve';
    if (b.unit && isStrictLike) throw new TypeError(`Cannot convert "${b.bytes}" to a color`);
    out = [calculate(aRGB[0], op, b.number), calculate(aRGB[1], op, b.number), calculate(aRGB[2], op, b.number)];
  } else if (b.type === 'Color') {
    const bRGB = colorRawRgb(b);
    out = [calculate(aRGB[0], op, bRGB[0]), calculate(aRGB[1], op, bRGB[1]), calculate(aRGB[2], op, bRGB[2])];
    newAlpha = a.alpha * (1 - b.alpha) + b.alpha;
  } else {
    throw new TypeError(`Cannot operate on ${b.type}`);
  }
  return makeColorRgb(out, newAlpha, a.format, a.modernSyntax ? { modernSyntax: true } : undefined);
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
  if (d.numerator) return { num: d.numerator.slice(), den: (d.denominator ?? []).slice(), backup: d.backupUnit };
  return { num: d.unit ? [d.unit] : [], den: [], backup: d.unit || undefined };
}

/** less.js `Unit.cancel`: remove numerator/denominator units that appear on both sides. */
function cancel(u: UnitSet): void {
  const counter = new Map<string, number>();
  for (const n of u.num) counter.set(n, (counter.get(n) ?? 0) + 1);
  for (const d of u.den) counter.set(d, (counter.get(d) ?? 0) - 1);
  const num: string[] = [];
  const den: string[] = [];
  for (const [unit, count] of counter) {
    for (let i = 0; i < count; i++) num.push(unit);
    for (let i = 0; i < -count; i++) den.push(unit);
  }
  u.num = num.sort();
  u.den = den.sort();
}

/**
 * less.js `Unit.genCSS` display rule (loose): a singular numerator emits that unit;
 * else the `backupUnit`; else the first denominator; else empty (a pure number).
 * In `strict` a non-singular unit is an error.
 */
function displayUnit(u: UnitSet, isStrict: boolean): string {
  // less.js `Unit.isSingular`: at most one numerator unit and no denominator.
  if (isStrict && !(u.num.length <= 1 && u.den.length === 0)) {
    throw new TypeError('Multiple units in dimension. Correct the units or use the unit function');
  }
  if (u.num.length === 1) return u.num[0]!;
  if (u.backup) return u.backup;
  if (u.den.length) return u.den[0]!;
  return '';
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
  if (b.number === 0 && op === '/') throw new TypeError('Cannot divide by zero');

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
        throw new TypeError(
          `Incompatible units. Change the units or use the unit function. Bad units: '${target}' and '${from}'.`,
        );
      }
      value = calculate(a.number, op, bVal);
    }
  } else if (op === '*') {
    u.num = u.num.concat(bu.num);
    u.den = u.den.concat(bu.den);
    cancel(u);
  } else if (op === '/') {
    u.num = u.num.concat(bu.den);
    u.den = u.den.concat(bu.num);
    cancel(u);
  }

  const unit = displayUnit(u, isStrict);
  // Persist the multiset only when it isn't a plain single numerator (so chained
  // ops can still cancel); a singular/empty unit round-trips through `makeDimension`.
  if (u.num.length === 1 && u.den.length === 0) return makeDimension(value, unit);
  return makeCompoundDimension(value, unit, u.num, u.den, u.backup);
}

/** Dimension ⊕ Color: coerce the dimension to a color, then color-operate. */
function dimensionAsColor(a: Dimension, b: Color, op: string, modes: EvalModes): Color {
  const isStrictLike = modes.unitMode === 'strict' || modes.unitMode === 'preserve';
  if (a.unit && isStrictLike) throw new TypeError(`Cannot convert "${a.bytes}" to a color`);
  const thisColor = makeColorRgb([a.number, a.number, a.number], 1, b.format ?? 1 /* RGB */);
  return colorOperate(thisColor, b, op, modes);
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
 * `calc(...)` rather than `calc(calc(...) op Y)`. A Paren-wrapped inner
 * expression keeps its paren (`calc((a - b))` -> `(a - b)`).
 *
 */
const calcInner = (bytes: string): string | null => {
  const m = CALC_WRAP_RE.exec(bytes.trim());
  return m ? m[1]! : null;
};

/**
 * Binary operation. Guard order (byte-faithful):
 *   1. a `calc(...)` keyword operand → splice its inner expression (flat calc),
 *   2. an un-operable keyword operand → preserve source `l op r`,
 *   3. else direct arithmetic; a unit-clash `TypeError` in `preserve` mode →
 *      `calc(l op r)` fallback.
 */
export function operate(op: string, left: ValueObj, right: ValueObj, modes: EvalModes): ValueObj {
  // Guard 1: calc-wrapper keyword operand → flat calc splice.
  // byte-faithful: opaque operand, no structured node — at the seam a calc
  // operand is always an already-materialized keyword (the structured `calc(...)`
  // FunctionCall was folded to bytes upstream), and a computed preserve-mode
  // `calc(...)` fallback result has no node at all, so both are string-unwrapped.
  const leftInner = left.type === 'Keyword' ? calcInner(left.bytes) : null;
  const rightInner = right.type === 'Keyword' ? calcInner(right.bytes) : null;
  if (leftInner !== null || rightInner !== null) {
    return makeKeyword(`calc(${leftInner ?? left.bytes} ${op} ${rightInner ?? right.bytes})`);
  }
  // Guard 2: an un-operable keyword operand → preserve source.
  if (left.type === 'Keyword' || right.type === 'Keyword') {
    return makeKeyword(`${left.bytes} ${op} ${right.bytes}`);
  }
  try {
    if (left.type === 'Dimension' && right.type === 'Dimension') {
      return dimensionOperate(left, right, op, modes);
    }
    if (left.type === 'Dimension' && right.type === 'Color') {
      return dimensionAsColor(left, right, op, modes);
    }
    if (left.type === 'Color') {
      return colorOperate(left, right, op, modes);
    }
    throw new TypeError(`Cannot operate on ${left.type}`);
  } catch (err) {
    if (err instanceof TypeError && modes.unitMode === 'preserve') {
      return makeKeyword(`calc(${left.bytes} ${op} ${right.bytes})`);
    }
    throw err;
  }
}
