/**
 * Byte-faithful port of `@jesscss/fns` `util/mathHelper` onto the value domain —
 * the shared kernel the unary number/unit math fns (`ceil`/`sin`/`sqrt`/…) reduce
 * to a one-liner over. Pulled once if ANY math fn is used; a stylesheet that calls
 * none never ships it.
 *
 * HARD MODULE BOUNDARY: value domain + factory only.
 */
import { isValueGroupArray, makeDimension, type Dimension, type FnSpec, type ValueGroup } from '@jesscss/core/value';

/**
 * Angle → radians normalization (`deg`/`grad`/`turn`), else the raw number.
 * Byte-identical to legacy `mathHelper`'s per-operand normalize step.
 */
const normalizeAngle = (d: Dimension): number => {
  switch (d.unit) {
    case 'deg': return d.number * Math.PI / 180;
    case 'grad': return d.number * Math.PI / 200;
    case 'turn': return d.number * 2 * Math.PI;
    default: return d.number;
  }
};

/**
 * Apply a numeric `fn` over dimension operands, byte-faithful to legacy `mathHelper`:
 *  - `outUnit === null`  → preserve the FIRST operand's unit, NO angle normalization
 *    (the `sqrt` path);
 *  - otherwise           → angle-normalize every operand; result unit is
 *    `outUnit ?? first.unit` (`''` for `sin`/`cos`/`tan`, `'rad'` for the inverse
 *    trig, `'%'` for `percentage`, and the preserved input unit for `ceil`/`floor`/
 *    `abs`/`round` which pass `undefined`).
 */
export function applyMath(
  fn: (...n: number[]) => number,
  outUnit: string | null | undefined,
  args: readonly Dimension[]
): Dimension {
  const first = args[0]!;
  if (outUnit === null) {
    return makeDimension(fn(...args.map(a => a.number)), first.unit);
  }
  return makeDimension(fn(...args.map(normalizeAngle)), outUnit ?? first.unit);
}

export function requireDimension(value: ValueGroup | undefined): Dimension {
  if (value === undefined || isValueGroupArray(value) || value.type !== 'Dimension') {
    throw new TypeError('Expected a dimension value');
  }
  return value;
}

/** Spec builder for a unary `dimension → dimension` math fn. Centralizes the bind-guaranteed cast. */
export const unaryMath = (fn: (n: number) => number, outUnit: string | null | undefined): FnSpec => ({
  params: [{ name: 'value', kinds: ['Dimension'] }],
  body: v => applyMath(fn, outUnit, [requireDimension(v)])
});
