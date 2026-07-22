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
import { isValueGroupArray, type Color, type Dimension, type EvalModes, type ValueGroup, type ValueObj } from './value-eval.js';
import { HEX } from './color.js';
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
function colorOperate(a: Color, b: ValueObj, op: string): Color {
  const aRGB = colorRawRgb(a);
  let newAlpha = a.alpha;
  let out: [number, number, number];
  if (b.type === 'Dimension') {
    // less.js `Dimension.toColor` treats the magnitude as a per-channel scalar and
    // IGNORES the unit (`#ff0000 + 10px` → `#ff0a0a`), so no unit clash here.
    out = [calculate(aRGB[0], op, b.number), calculate(aRGB[1], op, b.number), calculate(aRGB[2], op, b.number)];
  } else if (b.type === 'Color') {
    const bRGB = colorRawRgb(b);
    out = [calculate(aRGB[0], op, bRGB[0]), calculate(aRGB[1], op, bRGB[1]), calculate(aRGB[2], op, bRGB[2])];
    newAlpha = a.alpha * (1 - b.alpha) + b.alpha;
  } else {
    throw new TypeError(`Cannot operate on ${b.type}`);
  }
  // An OPERATED color is a fresh canonical result: less.js `Color.operate` yields a
  // bare rgb color with no source spelling, so it emits as HEX regardless of the
  // operands' authored `rgb()`/`hsl()` format (the verbatim rule preserves only
  // UN-operated literals). Drop `format`/`modernSyntax` → canonical `#rrggbb`.
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
 * less.js `Unit.genCSS` display rule: a singular numerator emits that unit;
 * else the `backupUnit`; else the first denominator; else empty (a pure number).
 * Strict-mode singularity is validated only when the final value is consumed;
 * intermediate compound units must remain available for a later operation to
 * cancel. A fully cancelled strict result is therefore a unitless number even
 * when its intermediate `backupUnit` was authored (e.g. `1px / 1px` → `1`).
 */
function displayUnit(u: UnitSet, isStrict: boolean): string {
  if (u.num.length === 1) {
    return u.num[0]!;
  }
  if (isStrict && u.num.length === 0 && u.den.length === 0) {
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
 * Less strict-units' singularity rule.
 */
export function validateFinalUnits(value: ValueGroup, modes: EvalModes): void {
  if (modes.unitMode !== 'strict') {
    return;
  }
  if (isValueGroupArray(value)) {
    for (const item of value) {
      validateFinalUnits(item, modes);
    }
    return;
  }
  if (value.type === 'Dimension') {
    const numerator = value.numerator ?? (value.unit ? [value.unit] : []);
    const denominator = value.denominator ?? [];
    if (numerator.length > 1 || denominator.length > 0) {
      throw new TypeError('Multiple units in dimension. Correct the units or use the unit function');
    }
    return;
  }
  if (value.type === 'List') {
    for (const item of value.value) {
      validateFinalUnits(item, modes);
    }
    return;
  }
  if (value.type === 'Block') {
    validateFinalUnits(value.inner, modes);
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
        throw new TypeError(
          `Incompatible units. Change the units or use the unit function. Bad units: '${target}' and '${from}'.`
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
  if (u.num.length === 1 && u.den.length === 0) {
    return makeDimension(value, unit);
  }
  return makeCompoundDimension(value, unit, u.num, u.den, u.backup);
}

/** Dimension ⊕ Color: coerce the dimension to a color (unit ignored, per less.js
 * `Dimension.toColor`), then color-operate. `10px + #ff0000` → `#ff0a0a`. */
function dimensionAsColor(a: Dimension, b: Color, op: string): Color {
  // `thisColor.format` is inert (colorOperate reads only its channels and always
  // returns a canonical HEX result), so build it as a plain HEX color.
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
  // Keep an additive nested calc as one authored computation when it is spliced
  // into another operation. CSS can flatten the wrapper, but Less retains this
  // grouping (`calc(2.25rem + 2px) - 2px` → `(2.25rem + 2px) - 2px`).
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
    const lb = leftInner !== null ? spliceInner(leftInner) : left.bytes;
    const rb = rightInner !== null ? spliceInner(rightInner) : right.bytes;
    return makeKeyword(`calc(${lb} ${op} ${rb})`);
  }
  // Guard 2: an un-operable keyword operand → preserve source.
  if (left.type === 'Keyword' || right.type === 'Keyword') {
    return makeKeyword(`${left.bytes} ${op} ${right.bytes}`);
  }
  // Guard 3: inside calc, a cross-unit dimension op does NOT collapse on raw
  // magnitudes — it is preserved as a flat `calc(l op r)` sub-expression.
  if (modes.inCalc && left.type === 'Dimension' && right.type === 'Dimension'
    && !calcSafe(op, left, right)) {
    return makeKeyword(`calc(${left.bytes} ${op} ${right.bytes})`);
  }
  // A percentage product has no standalone CSS dimensional value. Preserve it
  // as calc in the dialect's preserve mode even before an explicit calc wrapper;
  // otherwise a lazy variable binding such as `@x: 100% * 100%` collapses to the
  // invented scalar `10000%` and later composition cannot recover its semantics.
  if (modes.unitMode === 'preserve' && op === '*' && left.type === 'Dimension' && right.type === 'Dimension'
    && left.unit === '%' && right.unit === '%') {
    return makeKeyword(`calc(${left.bytes} ${op} ${right.bytes})`);
  }
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
