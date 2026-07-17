/**
 * SYNCHRONOUS value operations for the tree2 value domain — the
 * boundary-clean replacement for the adapter's legacy-delegating `operate` /
 * `materialize` / guard leaves. Implements dimension/color arithmetic (unit
 * conversion + rgb/hsl color math), plus the calc-splice + unoperable-keyword-
 * preserve + unit-clash → `calc()` guards.
 *
 * HARD MODULE BOUNDARY: imports only the value domain, the factory, the free
 * serializer, and the shared units table. Being synchronous is also what dissolves
 * the benchmark's async-dispatch throw.
 */
import type { Color, Dimension, EvalModes, ValueObj } from './value-eval.js';
import { colorRawRgb, makeColorRgb, makeDimension, makeKeyword } from './value-factory.js';
import { groupOf, unify, unitFactor } from './value-units.js';

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

/** Port of `Color.operate` (color ⊕ dimension | color ⊕ color). */
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

/** Port of `Dimension.operate` (dimension ⊕ dimension), unit-aware. */
function dimensionOperate(a: Dimension, b: Dimension, op: string, modes: EvalModes): Dimension {
  const aVal = a.number;
  let bVal = b.number;
  const aUnit = a.unit;
  const bUnit = b.unit;
  const isStrict = modes.unitMode === 'strict';
  const isPreserve = modes.unitMode === 'preserve';

  if (bVal === 0 && op === '/') throw new TypeError('Cannot divide by zero');

  if (!aUnit || !bUnit) {
    const outUnit = aUnit || bUnit;
    if ((isStrict || isPreserve) && bUnit && op === '/') {
      throw new TypeError('Cannot divide a number by a unit');
    }
    return makeDimension(calculate(aVal, op, bVal), outUnit);
  }

  if (aUnit === bUnit) {
    if (op === '+' || op === '-') return makeDimension(calculate(aVal, op, bVal), aUnit);
    if (isStrict || isPreserve) {
      if (op === '*') throw new TypeError('Cannot multiply two units together');
      return makeDimension(calculate(aVal, op, bVal), ''); // division cancels units
    }
    return makeDimension(calculate(aVal, op, bVal), aUnit);
  }

  const aGroup = groupOf(aUnit);
  const bGroup = groupOf(bUnit);
  if (aGroup === undefined || bGroup === undefined || aGroup !== bGroup) {
    if (isStrict || isPreserve) throw new TypeError('Incompatible units. Change the units or use the unit function');
    return makeDimension(calculate(aVal, op, bVal), aUnit);
  }
  const atomicUnit = unitFactor(aUnit);
  const targetUnit = unitFactor(bUnit);
  if (atomicUnit === undefined || targetUnit === undefined) {
    throw new TypeError('Incompatible units. Change the units or use the unit function');
  }
  if ((isPreserve || isStrict) && (op === '*' || op === '/')) {
    throw new TypeError('Cannot multiply or divide two units together');
  }
  bVal = bVal / (atomicUnit / targetUnit);
  return makeDimension(calculate(aVal, op, bVal), aUnit);
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
 * `null`. Byte-level port of the legacy `Operation.unwrapCalcOperand`: CSS
 * flattens nested calc, so a `calc(...)` operand composing into an outer
 * operation has its inner expression spliced in directly, yielding one flat
 * `calc(...)` rather than `calc(calc(...) op Y)`. A Paren-wrapped inner
 * expression keeps its paren (`calc((a - b))` -> `(a - b)`).
 *
 * SINGLE implementation: the transitional adapter (`tree2-frontend/value-eval`)
 * imports this rather than carrying its own twin.
 */
export const calcInner = (bytes: string): string | null => {
  const m = CALC_WRAP_RE.exec(bytes.trim());
  return m ? m[1]! : null;
};

/**
 * Binary operation. Reproduces the adapter's guard order byte-for-byte:
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

/* -------------------------------------------------------------- guards */

/** `Node.numericCompare`: EPSILON-fuzzed 3-way compare (float-precision tolerant). */
const numericCompare = (a: number, b: number): -1 | 0 | 1 =>
  a === b || Math.abs(a - b) < Number.EPSILON ? 0 : a > b ? 1 : -1;

/**
 * Dimension ⊕ Dimension comparison, unit-reconciling (stock Less 4.x
 * `Dimension.compare`, verified vs less@4.6.3):
 *  - either side unitless → compare raw numbers,
 *  - both have units → `unify` each to its group's canonical unit; equal canonical
 *    units compare numerically, incompatible/non-convertible units are INCOMPARABLE.
 * `%` is a REGULAR unit (NOT normalized to /100 — less@4.6.3: `50% = 0.5` is false,
 * `50% = 50` is true).
 */
function dimensionCompare(a: Dimension, b: Dimension): -1 | 0 | 1 | undefined {
  if (!a.unit || !b.unit) return numericCompare(a.number, b.number);
  const au = unify(a.number, a.unit);
  const bu = unify(b.number, b.unit);
  if (au.unit !== bu.unit) return undefined;
  return numericCompare(au.number, bu.number);
}

/**
 * Guard comparison (`@a > 0`) on typed operands. Dimensions reconcile units; any
 * other operand pair is equal iff its canonical bytes match, else INCOMPARABLE —
 * ordered `<`/`>`/`>=`/`<=` never fall back to a lexical byte compare (less@4.6.3
 * returns `undefined` for e.g. `foo < bar`, `#f00 > #0f0`, `"a" > "b"`).
 */
export function compare(op: string, left: ValueObj, right: ValueObj): boolean {
  const c: -1 | 0 | 1 | undefined =
    left.type === 'Dimension' && right.type === 'Dimension'
      ? dimensionCompare(left, right)
      : left.bytes === right.bytes ? 0 : undefined;
  switch (op) {
    case '=': return c === 0;
    case '>': return c === 1;
    case '<': return c === -1;
    case '>=': return c === 0 || c === 1;
    case '<=': return c === 0 || c === -1;
  }
  return false;
}

/**
 * Guard type-predicate (`iscolor(@a)` / `isnumber(@a)` / …) evaluated directly by
 * kind. Covers the foundation's predicate set; predicates that key off legacy
 * machinery are out of foundation scope (return `false`).
 */
export function typeCheck(name: string, args: readonly ValueObj[]): boolean {
  const a = args[0];
  if (a === undefined) return false;
  switch (name.toLowerCase()) {
    case 'iscolor': return a.type === 'Color';
    case 'isnumber': return a.type === 'Dimension';
    case 'isstring': return a.type === 'Quoted';
    case 'iskeyword': return a.type === 'Keyword';
    case 'ispixel': return a.type === 'Dimension' && a.unit === 'px';
    case 'ispercentage': return a.type === 'Dimension' && a.unit === '%';
    case 'isem': return a.type === 'Dimension' && a.unit === 'em';
    case 'isunit': {
      const u = args[1];
      const want = u === undefined ? '' : u.type === 'Quoted' ? u.value : u.bytes;
      return a.type === 'Dimension' && a.unit === want;
    }
    default: return false;
  }
}
