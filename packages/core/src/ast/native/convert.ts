import type { Dimension, Keyword, Quoted } from '../value-eval.js';
import { makeDimension, textOf } from '../value-factory.js';
import { groupOf, unitFactor } from '../value-units.js';
import type { NativeFn } from './types.js';

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
    const g = groupOf(from);
    if (g !== undefined && g === groupOf(target)) {
      return makeDimension(v.number * (unitFactor(from)! / unitFactor(target)!), target);
    }
    return makeDimension(v.number, v.unit);
  },
};
