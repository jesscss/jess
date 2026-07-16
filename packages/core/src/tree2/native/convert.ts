import type { Dimension, Keyword, Quoted } from '../value-eval.js';
import { makeDimension, textOf } from '../value-factory.js';
import type { NativeFn } from './types.js';

/** Unit conversion factors (relative to each group's base), ported from legacy `convert`. */
const CONVERSIONS: Record<string, Record<string, number>> = {
  length: { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, px: 0.0254 / 96, pt: 0.0254 / 72, pc: 0.0254 / 72 * 12 },
  duration: { s: 1, ms: 0.001 },
  angle: { rad: 1 / (2 * Math.PI), deg: 1 / 360, grad: 1 / 400, turn: 1 },
};

/**
 * `convert(value, unit)` — convert `value` to `unit` when they share a group; else
 * return the value canonicalized (an incompatible/no-op convert is still a COMPUTED
 * result, so it emits canonical bytes, matching the adapter's `render()`).
 */
export const convert: NativeFn = {
  name: 'convert',
  params: [{ kinds: ['dimension'] }, { kinds: ['keyword', 'quoted'] }],
  body: (value, unitArg) => {
    const v = value as Dimension;
    const from = v.unit;
    const target = textOf(unitArg as Keyword | Quoted);
    if (!from || !target || from === target) return makeDimension(v.number, v.unit);
    for (const group of Object.values(CONVERSIONS)) {
      const f = group[from];
      const t = group[target];
      if (f !== undefined && t !== undefined) return makeDimension(v.number * (f / t), target);
    }
    return makeDimension(v.number, v.unit);
  },
};
