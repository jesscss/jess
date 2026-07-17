/**
 * Guard-leaf evaluation for the value domain: the typed comparison (`@a > 0`) and
 * type-predicate (`iscolor(@a)`) that a guard condition reduces to. Operates on
 * already-materialized `ValueObj`s; arithmetic lives in `value-operate.ts`.
 *
 * HARD MODULE BOUNDARY: imports only the value domain + the shared units table.
 */
import type { Dimension, ValueObj } from './value-eval.js';
import { unify } from './value-units.js';

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
