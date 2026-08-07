/**
 * Guard-leaf evaluation for the value domain: the typed comparison (`@a > 0`) and
 * type-predicate (`iscolor(@a)`) that a guard condition reduces to. Operates on
 * already-materialized `Value`s; arithmetic lives in `value-operate.ts`.
 *
 * HARD MODULE BOUNDARY: imports only the value domain + the shared units table.
 */
import { UnitArithmeticError, isValueGroupArray, type Dimension, type ValueGroup, type Value } from './value-eval.js';
import { unify } from './value-units.js';
import type { EqualityMode, UnitMode } from '../types/modes.js';

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
 *
 * Under `unitMode: 'strict'` an unreconcilable pair THROWS rather than reporting
 * incomparable. Less 4.x — and jess before this — returned incomparable in every
 * mode, so `strictUnits` made `1px + 3em` a hard error while `2px > 1em` stayed a
 * silent `false`: the same operand pair, the same defect, two answers, and the
 * author cannot tell "not greater" from "never comparable". Arithmetic already
 * raises here (`dimensionOperate`); this is comparison catching up.
 */
function dimensionCompare(
  a: Dimension,
  b: Dimension,
  equalityMode: EqualityMode,
  unitMode: UnitMode | undefined
): -1 | 0 | 1 | undefined {
  /*
   * Less alone treats a unitless number as equivalent to the same magnitude
   * with a unit. Sass and exact retain the unit distinction while still
   * reconciling two compatible explicit units (1in = 96px).
   */
  if (!a.unit || !b.unit) {
    if (equalityMode !== 'less' && a.unit !== b.unit) {
      return undefined;
    }
    return numericCompare(a.number, b.number);
  }
  const au = unify(a.number, a.unit);
  const bu = unify(b.number, b.unit);
  if (au.unit !== bu.unit) {
    if (unitMode === 'strict') {
      throw new UnitArithmeticError(
        `Incompatible units. Change the units or use the unit function. Bad units: '${a.unit}' and '${b.unit}'.`
      );
    }
    return undefined;
  }
  return numericCompare(au.number, bu.number);
}

/** 3-way compare over primitives (`<`/`>` are lexical on strings); `!=` → undefined. */
const primCompare = (a: string | number, b: string | number): -1 | 0 | 1 | undefined =>
  a < b ? -1 : a === b ? 0 : a > b ? 1 : undefined;

/** `toCSS`-equivalent of a value operand (the byte form less.js compares by).
 *  An ESCAPED quoted string emits its raw contents (`~"x"` → `x`); a plain quoted
 *  string keeps its quotes; every other operand serializes to its own `bytes`. */
function toCssStr(v: Value): string {
  if (v.type === 'Quoted') {
    return v.escaped ? v.value : `${v.quote}${v.value}${v.quote}`;
  }
  return v.bytes;
}

/** Whether an operand carries a dedicated `.compare` (less.js: Dimension/Color/Quoted). */
function hasCompare(v: Value): boolean {
  return v.type === 'Dimension' || v.type === 'Color' || v.type === 'Quoted';
}

/** A single operand's OWN `.compare(other)` (less.js per-type methods). */
function selfCompare(a: Value, b: Value, equalityMode: EqualityMode, unitMode: UnitMode | undefined): -1 | 0 | 1 | undefined {
  switch (a.type) {
    case 'Dimension':
      return b.type === 'Dimension' ? dimensionCompare(a, b, equalityMode, unitMode) : undefined;
    case 'Color':
      // rgb + alpha equality only (no ordering).
      return b.type === 'Color'
        && b.rgb[0] === a.rgb[0] && b.rgb[1] === a.rgb[1] && b.rgb[2] === a.rgb[2]
        && b.alpha === a.alpha
        ? 0
        : undefined;
    case 'Quoted':
      /*
       * Two unescaped quoted strings compare LEXICALLY by contents (quote char
       * ignored); otherwise fall back to a symmetric `toCSS` equality.
       */
      return b.type === 'Quoted' && !a.escaped && !b.escaped
        ? primCompare(a.value, b.value)
        : toCssStr(a) === toCssStr(b) ? 0 : undefined;
    default:
      return undefined;
  }
}

const negate = (c: -1 | 0 | 1 | undefined): -1 | 0 | 1 | undefined => {
  if (c === undefined) {
    return undefined;
  }
  return c === -1 ? 1 : c === 1 ? -1 : 0;
};

/**
 * Faithful port of less.js `Node.compare(a, b)` over materialized operands:
 *  - a typed operand's own `.compare` wins UNLESS the other side is a quoted
 *    string (then a symmetric `toCSS` comparison is forced for stable results),
 *  - differing structural types are INCOMPARABLE (`undefined`),
 *  - same-type scalars are equal iff their values match; lists compare
 *    element-wise (same separator, length, and recursively-equal items).
 */
function compareNodes(a: Value, b: Value, equalityMode: EqualityMode, unitMode: UnitMode | undefined): -1 | 0 | 1 | undefined {
  /*
   * Less compares escaped/raw bytes (`~"…"` as Keyword, `e("…")` as
   * Any) against a typed comparable by emitted CSS bytes. Thus `3 = ~"3"`
   * and `3 = e("3")` are true even though the operands have different value
   * kinds. Keep this narrow to raw/keyword cross-kind equality; ordinary quoted
   * strings retain their quote bytes and therefore remain unequal.
   */
  if (equalityMode === 'sass') {
    const quoted = a.type === 'Quoted' ? a : b.type === 'Quoted' ? b : null;
    const keyword = a.type === 'Keyword' ? a : b.type === 'Keyword' ? b : null;
    if (quoted && quoted.value === keyword?.text) {
      return 0;
    }
  }
  if (equalityMode === 'less'
    && (hasCompare(a) || hasCompare(b))
    && (a.type === 'Keyword' || b.type === 'Keyword' || a.type === 'Any' || b.type === 'Any')
    && toCssStr(a) === toCssStr(b)) {
    return 0;
  }
  if (hasCompare(a) && b.type !== 'Quoted') {
    return selfCompare(a, b, equalityMode, unitMode);
  }
  if (hasCompare(b)) {
    return negate(selfCompare(b, a, equalityMode, unitMode));
  }
  if (a.type !== b.type) {
    return undefined;
  }
  if (a.type === 'Collection' && b.type === 'Collection') {
    /*
     * Two maps are equal when they hold the same key→value pairs. Order is NOT
     * part of map identity (Sass: `(a: 1, b: 2) == (b: 2, a: 1)`), even though the
     * entries stay ordered for iteration and emit — so this cannot be the default
     * `bytes` equality, which would call those two unequal.
     */
    if (a.entries.length !== b.entries.length) {
      return undefined;
    }
    for (const entry of a.entries) {
      const other = b.entries.find(candidate => compareGroups(candidate.key, entry.key, equalityMode, unitMode) === 0);
      if (other === undefined || compareGroups(other.value, entry.value, equalityMode, unitMode) !== 0) {
        return undefined;
      }
    }
    return 0;
  }
  if (a.type === 'List' && b.type === 'List') {
    if (a.sep !== b.sep || a.value.length !== b.value.length) {
      return undefined;
    }
    for (let i = 0; i < a.value.length; i++) {
      if (compareGroups(a.value[i]!, b.value[i]!, equalityMode, unitMode) !== 0) {
        return undefined;
      }
    }
    return 0;
  }
  return a.bytes === b.bytes ? 0 : undefined;
}

function compareGroups(a: ValueGroup, b: ValueGroup, equalityMode: EqualityMode, unitMode: UnitMode | undefined): -1 | 0 | 1 | undefined {
  if (isValueGroupArray(a) || isValueGroupArray(b)) {
    if (!isValueGroupArray(a) || !isValueGroupArray(b) || a.length !== b.length) {
      return undefined;
    }
    for (let index = 0; index < a.length; index += 1) {
      if (compareGroups(a[index]!, b[index]!, equalityMode, unitMode) !== 0) {
        return undefined;
      }
    }
    return 0;
  }
  return compareNodes(a, b, equalityMode, unitMode);
}

/**
 * Whether two operands share a TYPE, for `.jess`'s `==` (OPERATIONS.md §4.1:
 * "`=` compares on the common ground. `==` additionally requires the SAME TYPE").
 *
 * For dimensions the type is the unit GROUP, not the unit: `1in == 2.54cm` is
 * true because both are lengths and the ground converts, while `1 == 1px` is
 * false because unitless is its own type — it is the wildcard that makes `=`
 * loose, and `==` is exactly the operator that declines the wildcard. `2 == 2%`
 * is false for the same reason. Every other operand pair is same-type iff its
 * discriminants match.
 */
function sameType(a: ValueGroup, b: ValueGroup): boolean {
  if (isValueGroupArray(a) || isValueGroupArray(b)) {
    return isValueGroupArray(a) && isValueGroupArray(b)
      && a.length === b.length
      && a.every((item, index) => sameType(item, b[index]!));
  }
  if (a.type !== b.type) {
    return false;
  }
  if (a.type === 'Dimension' && b.type === 'Dimension') {
    if (!a.unit || !b.unit) {
      return !a.unit && !b.unit;
    }
    return unify(a.number, a.unit).unit === unify(b.number, b.unit).unit;
  }
  return true;
}

/**
 * Guard comparison (`@a > 0`) on typed operands, faithful to less.js `Node.compare`
 * (see {@link compareNodes}): dimensions reconcile units, quoted strings compare
 * lexically, colors/keywords/lists by structural equality. An INCOMPARABLE pair
 * (`undefined`) is false for every operator.
 */
export function compare(
  op: string,
  left: ValueGroup,
  right: ValueGroup,
  equalityMode: EqualityMode = 'less',
  unitMode?: UnitMode
): boolean {
  const c = compareGroups(left, right, equalityMode, unitMode);
  switch (op) {
    case '=': return c === 0;

    /*
     * `.jess`'s type-equal operator (OPERATIONS.md §4). It is `=` plus a type
     * check rather than a separate comparison: the pair still picks its common
     * ground and compares there once, and `==` only declines the coercions that
     * ground allows. `!=` is deliberately NOT added — `not(…)` covers negation
     * and the pair is redundant (§4.4.3).
     */
    case '==': return c === 0 && sameType(left, right);
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
export function typeCheck(name: string, args: readonly Value[]): boolean {
  const a = args[0];
  if (a === undefined) {
    return false;
  }
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
