import { numOf } from '../value-factory.js';
import { asList, coerceListItems, verbatimCall } from './list-helper.js';
import type { NativeFn } from './types.js';

/**
 * `extract(list, index)` — the 1-based `index`th element of `list`. A wrong arity
 * (not exactly `list, index`), a non-numeric index, or an out-of-range index
 * leaves the call UNEVALUATED (emitted verbatim), matching Less 4.x. Variadic:
 * receives the raw arg `List` so it can recover the list's real elements.
 */
export const extract: NativeFn = {
  name: 'extract',
  params: [{ kinds: 'any' }, { kinds: ['dimension'] }],
  variadic: true,
  body: (list) => {
    const l = asList(list);
    if (l.items.length !== 2) return verbatimCall('extract', l);
    const idxArg = l.items[1]!;
    if (idxArg.kind !== 'dimension') return verbatimCall('extract', l);
    const index = Math.trunc(numOf(idxArg));
    if (!Number.isFinite(index)) return verbatimCall('extract', l);
    const items = coerceListItems(l.items[0]);
    if (index < 1 || index > items.length) return verbatimCall('extract', l);
    return items[index - 1]!;
  },
};
