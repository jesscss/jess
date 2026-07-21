import { numOf } from '@jesscss/core/value';
import { asList, coerceListItems } from './list-helper.js';
import type { Fn } from '@jesscss/core/value';

/**
 * `extract(list, index)` — the 1-based `index`th element of `list`. A wrong arity
 * (not exactly `list, index`), a non-numeric index, or an out-of-range index
 * throws. The shared call evaluator owns preserve-versus-error policy. Variadic:
 * receives the raw arg `List` so it can recover the list's real elements.
 */
export const extract: Fn = {
  name: 'extract',
  params: [{ kinds: 'any' }, { kinds: ['Dimension'] }],
  variadic: true,
  body: (list) => {
    const l = asList(list);
    if (l.items.length !== 2) throw new TypeError('extract() requires exactly two arguments');
    const idxArg = l.items[1]!;
    if (idxArg.type !== 'Dimension') throw new TypeError('extract() index must be numeric');
    const index = Math.trunc(numOf(idxArg));
    if (!Number.isFinite(index)) throw new TypeError('extract() index must be finite');
    const items = coerceListItems(l.items[0]);
    if (index < 1 || index > items.length) throw new TypeError('extract() index is out of range');
    return items[index - 1]!;
  },
};
