import { asList, minMax } from './list-helper.js';
import type { Fn } from '@jesscss/core/value';

/**
 * `max(v1, v2, …)` — the largest of the (variadic, list-flattened) dimension
 * arguments, reduced by canonical unit. Incomparable units (or a non-dimension
 * arg) throw so the shared call boundary can preserve or report the resolved
 * failure. See `list-helper.ts` for the shared kernel.
 */
export const max: Fn = {
  name: 'max',
  params: [{ kinds: ['Dimension'] }],
  variadic: true,
  body: (list) => minMax(false, asList(list)),
};
