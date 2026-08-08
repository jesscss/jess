/**
 * Guard-leaf evaluation for the value domain: the typed comparison (`@a > 0`) and
 * type-predicate (`iscolor(@a)`) that a guard condition reduces to. Operates on
 * already-materialized `Value`s; arithmetic lives in `value-operate.ts`.
 *
 * HARD MODULE BOUNDARY: imports only the value domain + the shared units table.
 */
import {
  IncomparableOperandsError,
  UnitArithmeticError,
  isValueGroupArray,
  type Dimension,
  type ValueGroup,
  type Value
} from './value-eval.js';
import { unify } from './value-units.js';
import type { EqualityMode, UnitMode } from '../types/modes.js';

/**
 * §4.1's last row: the operand pair shares NO common ground (`1px > red`).
 *
 * Distinct from `undefined`, which means "there IS a ground and the pair is not
 * ORDERED on it" (`2px > 1em` outside strict units, two unequal colours, two
 * unequal lists). Equality collapses the two — both are `false` — but relational
 * does not: §4.2 makes it trichotomous over every grounded pair, so a pair with
 * no ground must ERROR rather than answer meaninglessly.
 */
const NO_GROUND = Symbol('no-common-ground');

/** A 3-way comparison outcome: ordered, unordered-on-a-ground, or {@link NO_GROUND}. */
type Compared = -1 | 0 | 1 | undefined | typeof NO_GROUND;

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
function selfCompare(a: Value, b: Value, equalityMode: EqualityMode, unitMode: UnitMode | undefined): Compared {
  switch (a.type) {
    case 'Dimension':
      return b.type === 'Dimension' ? dimensionCompare(a, b, equalityMode, unitMode) : noGround(a, b);
    case 'Color':
      // rgb + alpha equality only (no ordering) — a colour ground, never an order.
      if (b.type !== 'Color') {
        return noGround(a, b);
      }
      return b.rgb[0] === a.rgb[0] && b.rgb[1] === a.rgb[1] && b.rgb[2] === a.rgb[2] && b.alpha === a.alpha
        ? 0
        : undefined;
    case 'Quoted':
      /*
       * Two unescaped quoted strings compare LEXICALLY by contents (quote char
       * ignored); against anything else the pair takes §4.1's STRING ground and
       * compares each operand's own spelling — ORDERED, not equality-only. The
       * ground belongs to the PAIR, so `>` must find the same one `=` does.
       */
      return b.type === 'Quoted' && !a.escaped && !b.escaped
        ? primCompare(a.value, b.value)
        : primCompare(toCssStr(a), toCssStr(b));
    default:
      return undefined;
  }
}

const negate = (c: Compared): Compared => {
  if (c === undefined || c === NO_GROUND) {
    return c;
  }
  return c === -1 ? 1 : c === 1 ? -1 : 0;
};

/**
 * Kinds that are never the no-ground half of a cross-kind pair.
 *
 * §4.1 fixes the ground on the PAIR, never on the operator, so this predicate is
 * the whole of what relational and equality disagree about: they read the same
 * ground and only differ in what they do with it.
 *
 *  - `Any` is opaque UNQUOTED bytes — `e("4")`, and `~"4"`, which
 *    `serialize.ts` now lowers here rather than to a `Keyword`. §4.1's row 2 is
 *    "either side quoted → string ground: compare the other operand's OWN
 *    spelling", and that is what `toCssStr` yields for it. So `3 = ~"3"` is true
 *    AND `5 > ~"4"` is true, from ONE ground.
 *  - `Nil` grounds NUMERICALLY against a number (§4.1, `null` → `0`). Adopting
 *    that ground outright is phase 4's — it moves `null = 0` from false to true,
 *    and equality is not this phase's to change — and reporting the pair
 *    unordered already gives §4.2's answer for `null > 1`, which is `false`.
 *
 * A `Keyword` is deliberately NOT here. It is a bare identifier, not a string:
 * §4.1's last row gives `1px > red` and `1 < true` no ground at all, which is
 * §4.2's error row. That is the ONE distinction lost when `~"4"` lowered to a
 * `Keyword` — it made an unquoted string and an identifier the same operand.
 */
const noGround = (a: Value, b: Value): Compared =>
  a.type === 'Nil' || b.type === 'Nil' ? undefined : NO_GROUND;

/**
 * Faithful port of less.js `Node.compare(a, b)` over materialized operands:
 *  - a typed operand's own `.compare` wins UNLESS the other side is a quoted
 *    string (then a symmetric `toCSS` comparison is forced for stable results),
 *  - differing structural kinds share NO GROUND (§4.1's last row),
 *  - same-kind scalars compare LEXICOGRAPHICALLY on their own spelling; lists
 *    compare element-wise (same separator, length, and recursively-equal items).
 */
function compareNodes(a: Value, b: Value, equalityMode: EqualityMode, unitMode: UnitMode | undefined): Compared {
  /*
   * Sass unquotes a keyword against a quoted string for EQUALITY only.
   */
  if (equalityMode === 'sass') {
    const quoted = a.type === 'Quoted' ? a : b.type === 'Quoted' ? b : null;
    const keyword = a.type === 'Keyword' ? a : b.type === 'Keyword' ? b : null;
    if (quoted && quoted.value === keyword?.text) {
      return 0;
    }
  }

  /*
   * STRING GROUND (§4.1 row 2), taken by the PAIR before any typed dispatch: an
   * opaque unquoted operand (`e("4")`, `~"4"`) against anything compares each
   * side's OWN spelling, LEXICOGRAPHICALLY.
   *
   * This replaces an equality-only byte shortcut that answered `3 = ~"3"` true
   * while leaving `5 > ~"4"` groundless. That made the ground depend on the
   * OPERATOR, which §4.1 forbids — the pair picks the ground once, and equality
   * then asks "is it 0" while relational reads the order off the same answer.
   */
  if (a.type === 'Any' || b.type === 'Any') {
    return primCompare(toCssStr(a), toCssStr(b));
  }
  if (hasCompare(a) && b.type !== 'Quoted') {
    return selfCompare(a, b, equalityMode, unitMode);
  }
  if (hasCompare(b)) {
    return negate(selfCompare(b, a, equalityMode, unitMode));
  }
  if (a.type !== b.type) {
    return noGround(a, b);
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

  /*
   * STRING GROUND (§4.1): two operands of the same kind compare on their own
   * spellings, LEXICOGRAPHICALLY — not by byte equality alone. This is §4.2's
   * amendment: `b > a` is true and `a > b` false, where Less 4.6.3 answers false
   * to BOTH and leaves the author unable to tell "not greater" from "never
   * comparable". Equality is unaffected — `c === 0` is still exactly byte
   * equality.
   */
  return primCompare(a.bytes, b.bytes);
}

function compareGroups(a: ValueGroup, b: ValueGroup, equalityMode: EqualityMode, unitMode: UnitMode | undefined): Compared {
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
 * lexically, colors/lists by structural equality, and same-kind operands
 * lexicographically on their own spelling (§4.2's trichotomy).
 *
 * A pair that HAS a ground but no order on it is `false` for every operator. A
 * pair with NO ground is `false` for equality and an ERROR for relational.
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

    /*
     * RELATIONAL is trichotomous (§4.2). A pair with no common ground cannot be
     * ordered and must not silently answer `false` in both directions, so it
     * raises here — the one place relational and equality part company.
     */
    case '>':
    case '<':
    case '>=':
    case '<=':
    case '=<': {
      if (c === NO_GROUND) {
        throw new IncomparableOperandsError(
          `Incomparable operands. '${groupBytes(left)}' and '${groupBytes(right)}' share no common ground, so '${op}' has no answer.`
        );
      }
      switch (op) {
        case '>': return c === 1;
        case '<': return c === -1;
        case '>=': return c === 0 || c === 1;
        default: return c === 0 || c === -1;
      }
    }
  }
  return false;
}

/** An operand's authored spelling, for the incomparable-operands message. */
function groupBytes(v: ValueGroup): string {
  return isValueGroupArray(v) ? v.map(groupBytes).join(' ') : v.bytes;
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
