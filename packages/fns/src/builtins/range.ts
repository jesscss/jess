import type { Dimension, ValueObj } from '@jesscss/core/value';
import { makeDimension, makeList } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/**
 * `range(start)` / `range(start, end)` / `range(start, end, step)` — an inclusive
 * space-separated numeric list. `range(n)` counts `1..n`; with `end`, counts
 * `start..end`; `step` (default 1, non-zero) sets the increment. Items carry the
 * `end` bound's unit (byte-faithful to legacy `less/range`, which returns a
 * `Sequence`; here a space `List`).
 */
export const range: Fn = {
  name: 'range',
  params: [{ kinds: ['Dimension'] }, { kinds: ['Dimension'], optional: true }, { kinds: ['Dimension'], optional: true }],
  body: (start, end, step) => {
    const stepValue = step !== undefined ? (step as Dimension).number : 1;
    if (stepValue === 0) throw new RangeError('range() step cannot be 0');
    const to = end !== undefined ? (end as Dimension) : (start as Dimension);
    const from = end !== undefined ? (start as Dimension).number : 1;
    const items: ValueObj[] = [];
    for (let i = from; i <= to.number; i += stepValue) items.push(makeDimension(i, to.unit));
    return makeList(items, ' ');
  },
};
