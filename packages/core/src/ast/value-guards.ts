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
import { namedColor } from './color-names.js';
import type { UnitMode } from '../types/modes.js';

/**
 * The comparison KIND, carried by the guard node's own `op` (§5.1). There is no
 * `equalityMode`: a dialect front end does not pick a runtime flag, it lowers to
 * the primitive that says what it means.
 *
 *  - `'='`  — LOOSE. The operand pair picks §4.1's common ground and compares
 *    there once. A unitless number is a wildcard against a unit; a quoted
 *    operand puts the pair on string ground, where a value equals its own
 *    spelling. `.less` and `.jess` `=` both lower here.
 *  - `'=='` — TYPE-EQUAL. `'='` plus {@link sameType}: it declines exactly the
 *    coercions the ground allows. `.jess` `==` lowers here.
 *  - {@link SASS_EQUAL} — the Sass-equality PRIMITIVE. Sass `==` is unit-strict
 *    on numbers and quote-insensitive on text, so NEITHER operator reproduces it
 *    alone, and for `$a == $b` the operand types are unknown until eval — a
 *    front end cannot pick. It therefore dispatches on operand TYPE here:
 *    type-equal for a numeric pair, loose for everything else. Dispatching on
 *    operand type is this primitive's definition, not an ambient mode: nothing
 *    is read from config, the node says which comparison it is.
 *
 * Relational (`>` `<` `>=` `<=` `=<`) reads the SAME ground and only differs in
 * what it does with it (§4.2).
 */
export const SASS_EQUAL = 'sass-equal';

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

/**
 * 3-way numeric compare, tolerant of CONVERSION error.
 *
 * The tolerance is RELATIVE, not the absolute `Number.EPSILON` this used to
 * apply. `1in` and `2.54cm` are the same length by definition, but both convert
 * through a canonical unit and land on `96` and `96.00000000000001` — a gap of
 * 1.4e-14, four hundred million times `Number.EPSILON`, so an absolute fuzz
 * called them unequal. That is O-TRUTH-3: lessc 4.6.3's `false` for
 * `1in = 2.54cm` is a conversion-precision bug, not a dialect choice. `1e-10`
 * is the same tolerance the numeric emit path trims at, so a pair that prints
 * identically compares equal.
 */
const COMPARE_TOLERANCE = 1e-10;
const numericCompare = (a: number, b: number): -1 | 0 | 1 => {
  if (a === b) {
    return 0;
  }
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= COMPARE_TOLERANCE * scale ? 0 : a > b ? 1 : -1;
};

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
  unitMode: UnitMode | undefined
): -1 | 0 | 1 | undefined {
  /*
   * A unitless operand is a WILDCARD on numeric ground (§4.1): it compares on
   * raw magnitude against any unit. That is the whole of what makes `=` loose,
   * and it is unconditional now — the unit distinction is not retained by an
   * ambient mode but DECLINED by the operator, in `sameType`, which `==` and the
   * numeric arm of {@link SASS_EQUAL} apply on top of this ground.
   */
  if (!a.unit || !b.unit) {
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

/**
 * An operand's SPELLING — what it is on §4.1's string ground.
 *
 * A quoted string spells its CONTENTS, quote characters excluded, escaped or
 * not. "A value equals its own spelling" is the whole quoted rule, and it is
 * what makes `1px = "1px"`, `1 = "1"` and `a = "a"` all true for one reason.
 * This used to keep the quotes on an unescaped string, which is what made Less
 * text-strict; dropping them is §5.2's real `.less` output shift (false → true),
 * taken deliberately so that one set of semantics holds across the dialects.
 */
function toCssStr(v: Value): string {
  return v.type === 'Quoted' ? v.value : v.bytes;
}

/**
 * The colour an operand IS, or `undefined` — a `Color` value, or a `Keyword`
 * that spells a CSS colour name (`black`, `transparent`).
 *
 * §4.1's "both colours" ground has to reach a NAMED colour, because a bare
 * `black` materializes as a `Keyword`: without this, `black = #000000` compares
 * two structural kinds, finds no ground, and answers false against the table.
 */
function asColor(v: Value): { rgb: readonly number[]; alpha: number } | undefined {
  if (v.type === 'Color') {
    return v;
  }
  return v.type === 'Keyword' ? namedColor(v.text) : undefined;
}

/** Colour ground: rgb + alpha equality, never an order (§4.1 / §4.2). */
const colorCompare = (a: NonNullable<ReturnType<typeof asColor>>, b: NonNullable<ReturnType<typeof asColor>>): 0 | undefined =>
  a.rgb[0] === b.rgb[0] && a.rgb[1] === b.rgb[1] && a.rgb[2] === b.rgb[2] && a.alpha === b.alpha ? 0 : undefined;

/** Whether an operand carries a dedicated `.compare` (less.js: Dimension/Color/Quoted). */
function hasCompare(v: Value): boolean {
  return v.type === 'Dimension' || v.type === 'Color' || v.type === 'Quoted';
}

/** A single operand's OWN `.compare(other)` (less.js per-type methods). */
function selfCompare(a: Value, b: Value, unitMode: UnitMode | undefined): Compared {
  switch (a.type) {
    case 'Dimension':
      return b.type === 'Dimension' ? dimensionCompare(a, b, unitMode) : noGround();
    case 'Color': {
      /*
       * COLOUR ground (§4.1 row 3): rgb + alpha equality only, never an order.
       * The other side may spell its colour as a NAME (`black == #000000`); a
       * non-colour operand shares no ground at all.
       */
      const other = asColor(b);
      return other === undefined ? noGround() : colorCompare(a, other);
    }
    case 'Quoted':
      /*
       * STRING ground (§4.1 row 2), ORDERED, not equality-only: both operands
       * compare on their own SPELLING, so `>` finds the same ground `=` does.
       * A quoted operand spells its contents, which is why this is one branch
       * now rather than a quoted-pair special case plus a fallback.
       */
      return primCompare(toCssStr(a), toCssStr(b));
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
 * A `Keyword` is deliberately NOT here. It is a bare identifier, not a string:
 * §4.1's last row gives `1px > red` and `1 < true` no ground at all, which is
 * §4.2's error row. That is the ONE distinction lost when `~"4"` lowered to a
 * `Keyword` — it made an unquoted string and an identifier the same operand.
 */
const noGround = (): Compared => NO_GROUND;

/**
 * `null`'s NUMERIC ground (§4.1 row 4): against a number, `null` compares AS `0`.
 * A frozen operand rather than a fresh `makeDimension(0)` per comparison, and a
 * real `Dimension` rather than a bare `0` so the pair goes through
 * {@link dimensionCompare} and inherits its unit rules unchanged — `null = 0` is
 * true, and `null = 0px` answers whatever `1 = 1px` answers.
 */
const NULL_AS_ZERO: Dimension = { type: 'Dimension', number: 0, unit: '', bytes: '0' };

/**
 * §4.1's `null` row, taken by the PAIR before any typed dispatch.
 *
 * `null` grounds NUMERICALLY against a number and has NO ground with anything
 * else, which is exactly the two answers the target table needs: `null = 0` is
 * true (numeric ground), `null > 1` is false (`0 > 1`, §4.2's row), and
 * `null = false` stays false because the pair never finds a ground at all.
 *
 * Two `null`s are equal — the same value on the same ground.
 */
function nullCompare(a: Value, b: Value, unitMode: UnitMode | undefined): Compared {
  if (a.type === 'Null' && b.type === 'Null') {
    return 0;
  }
  if (a.type === 'Null') {
    return b.type === 'Dimension' ? dimensionCompare(NULL_AS_ZERO, b, unitMode) : NO_GROUND;
  }
  return a.type === 'Dimension' ? dimensionCompare(a, NULL_AS_ZERO, unitMode) : NO_GROUND;
}

/**
 * Faithful port of less.js `Node.compare(a, b)` over materialized operands:
 *  - a typed operand's own `.compare` wins UNLESS the other side is a quoted
 *    string (then a symmetric `toCSS` comparison is forced for stable results),
 *  - differing structural kinds share NO GROUND (§4.1's last row),
 *  - same-kind scalars compare LEXICOGRAPHICALLY on their own spelling; lists
 *    compare element-wise (same separator, length, and recursively-equal items).
 */
function compareNodes(a: Value, b: Value, unitMode: UnitMode | undefined): Compared {
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
  if (a.type === 'Null' || b.type === 'Null') {
    return nullCompare(a, b, unitMode);
  }
  if (a.type === 'Any' || b.type === 'Any') {
    return primCompare(toCssStr(a), toCssStr(b));
  }
  if (hasCompare(a) && b.type !== 'Quoted') {
    return selfCompare(a, b, unitMode);
  }
  if (hasCompare(b)) {
    return negate(selfCompare(b, a, unitMode));
  }
  if (a.type !== b.type) {
    return noGround();
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
      const other = b.entries.find(candidate => compareGroups(candidate.key, entry.key, unitMode) === 0);
      if (other === undefined || compareGroups(other.value, entry.value, unitMode) !== 0) {
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
      if (compareGroups(a.value[i]!, b.value[i]!, unitMode) !== 0) {
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

function compareGroups(a: ValueGroup, b: ValueGroup, unitMode: UnitMode | undefined): Compared {
  if (isValueGroupArray(a) || isValueGroupArray(b)) {
    if (!isValueGroupArray(a) || !isValueGroupArray(b) || a.length !== b.length) {
      return undefined;
    }
    for (let index = 0; index < a.length; index += 1) {
      if (compareGroups(a[index]!, b[index]!, unitMode) !== 0) {
        return undefined;
      }
    }
    return 0;
  }
  return compareNodes(a, b, unitMode);
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
    /*
     * A COLOUR is a colour however it is spelled. `black == #000000` is the
     * colour ground's type-equal row: the pair already compares as colours
     * under `=`, and `==` declines COERCIONS, not spellings — a named colour
     * and a hex colour are one type, so nothing is being coerced here.
     */
    return asColor(a) !== undefined && asColor(b) !== undefined;
  }
  if (a.type === 'Dimension' && b.type === 'Dimension') {
    if (!a.unit || !b.unit) {
      return !a.unit && !b.unit;
    }
    return unify(a.number, a.unit).unit === unify(b.number, b.unit).unit;
  }
  return true;
}

/** Whether BOTH operands are numbers — the type {@link SASS_EQUAL} dispatches on. */
const isNumericPair = (a: ValueGroup, b: ValueGroup): boolean =>
  !isValueGroupArray(a) && !isValueGroupArray(b) && a.type === 'Dimension' && b.type === 'Dimension';

/**
 * A 3-way ORDER over two operands, on §4.1's ground — the ordering primitive
 * every in-repo consumer that needs `<`/`=`/`>` rather than a boolean shares
 * (`fns/`'s Sass `min`/`max` folds with it). THROWS when the pair has no ground
 * or no order on the one it has, because a fold cannot represent "unordered".
 */
export function compareOrder(left: ValueGroup, right: ValueGroup, unitMode?: UnitMode): -1 | 0 | 1 {
  const c = compareGroups(left, right, unitMode);
  if (c === undefined || c === NO_GROUND) {
    throw new IncomparableOperandsError(
      `Incomparable operands. '${groupBytes(left)}' and '${groupBytes(right)}' share no common ground, so they cannot be ordered.`
    );
  }
  return c;
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
  unitMode?: UnitMode
): boolean {
  const c = compareGroups(left, right, unitMode);
  switch (op) {
    case '=': return c === 0;

    /*
     * The Sass-equality PRIMITIVE (§5.1), which `.scss` lowers `==` to. It
     * DISPATCHES on operand type rather than reading a mode: unit-strict on a
     * numeric pair (`1 == 1px` is false), loose on everything else (`a == "a"`
     * is true). Neither `=` nor `==` reproduces that alone, and the operand
     * types are not known until here, so this is the one comparison a front end
     * cannot resolve by substituting an operator.
     */
    case SASS_EQUAL:
      return c === 0 && (isNumericPair(left, right) ? sameType(left, right) : true);

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
