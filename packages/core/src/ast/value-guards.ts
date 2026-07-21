/**
 * Guard-leaf evaluation for the value domain: the typed comparison (`@a > 0`) and
 * type-predicate (`iscolor(@a)`) that a guard condition reduces to. Operates on
 * already-materialized `ValueObj`s; arithmetic lives in `value-operate.ts`.
 *
 * HARD MODULE BOUNDARY: imports only the value domain + the shared units table.
 */
import type { Dimension, ValueObj } from './value-eval.js';
import { unify } from './value-units.js';
import type { EqualityMode } from '../types/modes.js';

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
function dimensionCompare(a: Dimension, b: Dimension, equalityMode: EqualityMode): -1 | 0 | 1 | undefined {
  // Less alone treats a unitless number as equivalent to the same magnitude
  // with a unit. Sass and exact retain the unit distinction while still
  // reconciling two compatible explicit units (1in = 96px).
  if (!a.unit || !b.unit) {
    if (equalityMode !== 'less' && a.unit !== b.unit) return undefined;
    return numericCompare(a.number, b.number);
  }
  const au = unify(a.number, a.unit);
  const bu = unify(b.number, b.unit);
  if (au.unit !== bu.unit) return undefined;
  return numericCompare(au.number, bu.number);
}

/** 3-way compare over primitives (`<`/`>` are lexical on strings); `!=` → undefined. */
const primCompare = (a: string | number, b: string | number): -1 | 0 | 1 | undefined =>
  a < b ? -1 : a === b ? 0 : a > b ? 1 : undefined;

/** `toCSS`-equivalent of a value operand (the byte form less.js compares by).
 *  An ESCAPED quoted string emits its raw contents (`~"x"` → `x`); a plain quoted
 *  string keeps its quotes; every other operand serializes to its own `bytes`. */
function toCssStr(v: ValueObj): string {
  if (v.type === 'Quoted') return v.escaped ? v.value : `${v.quote}${v.value}${v.quote}`;
  return v.bytes;
}

/** Whether an operand carries a dedicated `.compare` (less.js: Dimension/Color/Quoted). */
function hasCompare(v: ValueObj): boolean {
  return v.type === 'Dimension' || v.type === 'Color' || v.type === 'Quoted';
}

/** A single operand's OWN `.compare(other)` (less.js per-type methods). */
function selfCompare(a: ValueObj, b: ValueObj, equalityMode: EqualityMode): -1 | 0 | 1 | undefined {
  switch (a.type) {
    case 'Dimension':
      return b.type === 'Dimension' ? dimensionCompare(a, b, equalityMode) : undefined;
    case 'Color':
      // rgb + alpha equality only (no ordering).
      return b.type === 'Color'
        && b.rgb[0] === a.rgb[0] && b.rgb[1] === a.rgb[1] && b.rgb[2] === a.rgb[2]
        && b.alpha === a.alpha
        ? 0 : undefined;
    case 'Quoted':
      // Two unescaped quoted strings compare LEXICALLY by contents (quote char
      // ignored); otherwise fall back to a symmetric `toCSS` equality.
      return b.type === 'Quoted' && !a.escaped && !b.escaped
        ? primCompare(a.value, b.value)
        : toCssStr(a) === toCssStr(b) ? 0 : undefined;
    default:
      return undefined;
  }
}

const negate = (c: -1 | 0 | 1 | undefined): -1 | 0 | 1 | undefined =>
  c === undefined ? undefined : (-c as -1 | 0 | 1);

/**
 * Faithful port of less.js `Node.compare(a, b)` over materialized operands:
 *  - a typed operand's own `.compare` wins UNLESS the other side is a quoted
 *    string (then a symmetric `toCSS` comparison is forced for stable results),
 *  - differing structural types are INCOMPARABLE (`undefined`),
 *  - same-type scalars are equal iff their values match; lists compare
 *    element-wise (same separator, length, and recursively-equal items).
 */
function compareNodes(a: ValueObj, b: ValueObj, equalityMode: EqualityMode): -1 | 0 | 1 | undefined {
  // Less compares an escaped quote (and e("…"), both materialized as a
  // Keyword) against a typed comparable by its emitted CSS bytes. Thus
  // `3 = ~"3"` is true even though the operands have different value kinds.
  // Keep this narrow to Keyword cross-kind equality; ordinary quoted strings
  // retain their quote bytes and therefore remain unequal.
  if (equalityMode === 'sass') {
    const quoted = a.type === 'Quoted' ? a : b.type === 'Quoted' ? b : null;
    const keyword = a.type === 'Keyword' ? a : b.type === 'Keyword' ? b : null;
    if (quoted && keyword && quoted.value === keyword.text) return 0;
  }
  if (equalityMode === 'less'
    && (hasCompare(a) || hasCompare(b))
    && (a.type === 'Keyword' || b.type === 'Keyword')
    && toCssStr(a) === toCssStr(b)) return 0;
  if (hasCompare(a) && b.type !== 'Quoted') return selfCompare(a, b, equalityMode);
  if (hasCompare(b)) return negate(selfCompare(b, a, equalityMode));
  if (a.type !== b.type) return undefined;
  if (a.type === 'List' && b.type === 'List') {
    if (a.sep !== b.sep || a.items.length !== b.items.length) return undefined;
    for (let i = 0; i < a.items.length; i++) {
      if (compareNodes(a.items[i]!, b.items[i]!, equalityMode) !== 0) return undefined;
    }
    return 0;
  }
  return a.bytes === b.bytes ? 0 : undefined;
}

/**
 * Guard comparison (`@a > 0`) on typed operands, faithful to less.js `Node.compare`
 * (see {@link compareNodes}): dimensions reconcile units, quoted strings compare
 * lexically, colors/keywords/lists by structural equality. An INCOMPARABLE pair
 * (`undefined`) is false for every operator.
 */
export function compare(op: string, left: ValueObj, right: ValueObj, equalityMode: EqualityMode = 'less'): boolean {
  const c = compareNodes(left, right, equalityMode);
  switch (op) {
    case '=': return c === 0;
    case '>': return c === 1;
    case '<': return c === -1;
    case '>=': return c === 0 || c === 1;
    case '<=':
    case '=<': return c === 0 || c === -1;
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
