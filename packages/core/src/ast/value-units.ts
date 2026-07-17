/**
 * The SINGLE unit-conversion table for the value domain: length / duration / angle
 * units and their factors relative to each group's base. Consumed by dimension
 * arithmetic (`value-operate`), comparison (`value-guards`), and the `convert()` /
 * min-max unify fns.
 *
 * HARD MODULE BOUNDARY: pure data + pure lookups, imports nothing.
 */

export const enum UnitGroup { Length = 0, Duration = 1, Angle = 2 }

/** Per-group conversion factors: unit → factor relative to the group base. */
const GROUP_FACTORS: readonly Readonly<Record<string, number>>[] = [
  { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, px: 0.0254 / 96, pt: 0.0254 / 72, pc: (0.0254 / 72) * 12 },
  { s: 1, ms: 0.001 },
  { rad: 1 / (2 * Math.PI), deg: 1 / 360, grad: 1 / 400, turn: 1 },
];

/** The canonical unit each group unifies TO (`Dimension.unify`): length→px, duration→s, angle→rad. */
const GROUP_CANONICAL = ['px', 's', 'rad'] as const;

/** Each group's canonical-unit factor, so `unify` needn't re-look-it-up per call. */
const GROUP_CANONICAL_FACTOR = GROUP_FACTORS.map((f, g) => f[GROUP_CANONICAL[g]!]!);

const UNIT_TO_GROUP = new Map<string, UnitGroup>();
for (let g = 0; g < GROUP_FACTORS.length; g++) {
  for (const u in GROUP_FACTORS[g]!) UNIT_TO_GROUP.set(u, g as UnitGroup);
}

/** The conversion group a unit belongs to, or `undefined` when it isn't convertible. */
export const groupOf = (unit: string): UnitGroup | undefined => UNIT_TO_GROUP.get(unit);

/** A unit's conversion factor (relative to its group base), or `undefined` when non-convertible. */
export const unitFactor = (unit: string): number | undefined => {
  const g = UNIT_TO_GROUP.get(unit);
  return g === undefined ? undefined : GROUP_FACTORS[g]![unit];
};

/**
 * `Dimension.unify()`: convert `number`+`unit` to its group's canonical unit. A unit
 * outside every group (including the empty unit) is returned unchanged.
 */
export function unify(number: number, unit: string): { number: number; unit: string } {
  const g = UNIT_TO_GROUP.get(unit);
  if (g === undefined) return { number, unit };
  return { number: number * (GROUP_FACTORS[g]![unit]! / GROUP_CANONICAL_FACTOR[g]!), unit: GROUP_CANONICAL[g] };
}
