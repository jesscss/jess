/**
 * The SINGLE unit-conversion table for the value domain: length / duration / angle
 * units and their factors relative to each group's base. Consumed by dimension
 * arithmetic (`value-operate`), comparison (`value-guards`), and the `convert()` /
 * min-max unify fns.
 *
 * HARD MODULE BOUNDARY: pure data + pure lookups, imports nothing.
 */

export const enum UnitGroup { Length = 0, Duration = 1, Angle = 2 }

/**
 * Per-group conversion factors: unit → factor relative to the group base. Keys
 * are lowercase; every lookup goes through {@link foldUnit}.
 */
const GROUP_FACTORS: readonly Readonly<Record<string, number>>[] = [
  { m: 1, cm: 0.01, mm: 0.001, q: 0.001 / 4, in: 0.0254, px: 0.0254 / 96, pt: 0.0254 / 72, pc: (0.0254 / 72) * 12 },
  { s: 1, ms: 0.001 },
  { rad: 1 / (2 * Math.PI), deg: 1 / 360, grad: 1 / 400, turn: 1 }
];

/** The canonical unit each group unifies TO (`Dimension.unify`): length→px, duration→s, angle→rad. */
const GROUP_CANONICAL = ['px', 's', 'rad'] as const;

/** Each group's canonical-unit factor, so `unify` needn't re-look-it-up per call. */
const GROUP_CANONICAL_FACTOR = GROUP_FACTORS.map((f, g) => f[GROUP_CANONICAL[g]!]!);

const UNIT_TO_GROUP = new Map<string, UnitGroup>();
for (let g = 0; g < GROUP_FACTORS.length; g++) {
  for (const u in GROUP_FACTORS[g]!) {
    UNIT_TO_GROUP.set(u, g as UnitGroup);
  }
}

/**
 * A unit as math identifies it: ASCII-lowercased, since CSS units are ASCII
 * case-insensitive (css-values-4 §2.3) — `1PX + 1mm` converts like `1px + 1mm`
 * (ledger V37). Only the comparison folds: an operated result keeps the
 * operand's spelling and an unoperated value is emitted as written. A unit
 * with no uppercase letter (the common case) is returned as is, unallocated.
 */
export function foldUnit(unit: string): string {
  for (let i = 0; i < unit.length; i++) {
    const c = unit.charCodeAt(i);
    if (c >= 65 && c <= 90) {
      return unit.replace(/[A-Z]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 32));
    }
  }
  return unit;
}

/** The conversion group a unit belongs to, or `undefined` when it isn't convertible. */
export const groupOf = (unit: string): UnitGroup | undefined => UNIT_TO_GROUP.get(foldUnit(unit));

/** A unit's conversion factor (relative to its group base), or `undefined` when non-convertible. */
export const unitFactor = (unit: string): number | undefined => {
  const key = foldUnit(unit);
  const g = UNIT_TO_GROUP.get(key);
  return g === undefined ? undefined : GROUP_FACTORS[g]![key];
};

/**
 * `Dimension.unify()`: convert `number`+`unit` to its group's canonical unit. A unit
 * outside every group (including the empty unit) is returned folded
 * ({@link foldUnit}), so the result is the unit's comparison identity.
 */
export function unify(number: number, unit: string): { number: number; unit: string } {
  const key = foldUnit(unit);
  const g = UNIT_TO_GROUP.get(key);
  if (g === undefined) {
    return { number, unit: key };
  }
  return { number: number * (GROUP_FACTORS[g]![key]! / GROUP_CANONICAL_FACTOR[g]!), unit: GROUP_CANONICAL[g] };
}

/**
 * Whether `fromUnit` converts to `toUnit`: the same unit ({@link foldUnit}), or
 * two units of one conversion group. Decided by GROUP, never by whether a
 * converted magnitude happened to change — a zero RHS (`1cm + 0mm`) converts
 * like any other.
 */
export const convertible = (fromUnit: string, toUnit: string): boolean => {
  if (fromUnit === toUnit) {
    return true;
  }
  const from = foldUnit(fromUnit);
  const to = foldUnit(toUnit);
  if (from === to) {
    return true;
  }
  const fg = UNIT_TO_GROUP.get(from);
  return fg !== undefined && fg === UNIT_TO_GROUP.get(to);
};

/**
 * less.js `Dimension.convertTo`: rescale `number` from `fromUnit` to `toUnit` when
 * both share a conversion group. A non-convertible or cross-group pair (e.g.
 * `em`→`px`, `px`→`s`) is returned unchanged — matching less.js loose `+`/`-`, which
 * then operates on the raw magnitudes (`1px + 1em` → `2px`).
 */
export function convertValue(number: number, fromUnit: string, toUnit: string): number {
  if (fromUnit === toUnit) {
    return number;
  }
  const from = foldUnit(fromUnit);
  const to = foldUnit(toUnit);
  const fg = UNIT_TO_GROUP.get(from);
  const tg = UNIT_TO_GROUP.get(to);
  if (from === to || fg === undefined || tg === undefined || fg !== tg) {
    return number;
  }
  return number * (GROUP_FACTORS[fg]![from]! / GROUP_FACTORS[tg]![to]!);
}

/**
 * The identity of a compound unit multiset (`px*px`, `em/cm`): its numerator
 * and denominator units, each sorted, spelled `a*b/c`. Two compound values share
 * a unit exactly when their keys are equal. That is the identical-multiset rule
 * `+`/`-` apply to a compound operand (ledger V18) and the one comparison
 * applies to it, so the two never disagree. Each unit is folded
 * ({@link foldUnit}) but not converted: a compound result keeps the units its
 * operands were written in.
 */
export function unitMultisetKey(numerator: readonly string[], denominator: readonly string[]): string {
  const num = numerator.length < 2 ? foldUnit(numerator[0] ?? '') : numerator.map(foldUnit).sort().join('*');
  if (denominator.length === 0) {
    return num;
  }
  return `${num}/${denominator.length < 2 ? foldUnit(denominator[0]!) : denominator.map(foldUnit).sort().join('*')}`;
}
