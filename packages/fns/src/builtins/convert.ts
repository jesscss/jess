import type { Dimension, Keyword, Quoted, Fn } from '@jesscss/core/value';
import { makeDimension, textOf, defineFunction, groupOf, unitFactor } from '@jesscss/core/value';

/**
 * `convert(value, unit)` — convert `value` to `unit` when they share a group; else
 * return the value canonicalized (an incompatible/no-op convert is still a COMPUTED
 * result, so it emits canonical bytes, matching the adapter's `render()`).
 */
export const convert: Fn = defineFunction('convert', {
  params: [{ kinds: ['Dimension'] }, { kinds: ['Keyword', 'Quoted'] }],
  body: (value, unitArg) => {
    const v = value as Dimension;
    const from = v.unit;
    const target = textOf(unitArg as Keyword | Quoted);
    if (!from || !target || from === target) {
      return makeDimension(v.number, v.unit);
    }
    const g = groupOf(from);
    if (g !== undefined && g === groupOf(target)) {
      return makeDimension(v.number * (unitFactor(from)! / unitFactor(target)!), target);
    }
    return makeDimension(v.number, v.unit);
  }
});
