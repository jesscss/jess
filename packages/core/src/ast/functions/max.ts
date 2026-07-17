import { asList, minMax } from './list-helper.js';
import type { Fn } from './types.js';

/**
 * `max(v1, v2, …)` — the largest of the (variadic, list-flattened) dimension
 * arguments, reduced by canonical unit. Incomparable units (or a non-dimension
 * arg) leave the call as a CSS `max(...)` verbatim. Byte-faithful to Less 4.x
 * (`minMax`); see `list-helper.ts` for the shared kernel.
 */
export const max: Fn = {
  name: 'max',
  params: [{ kinds: ['dimension'] }],
  variadic: true,
  body: (list) => minMax(false, asList(list)),
};
