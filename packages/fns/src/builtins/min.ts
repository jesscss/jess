import { asList, minMax } from './list-helper.js';
import type { Fn } from '@jesscss/core/value';

/**
 * `min(v1, v2, …)` — the smallest of the (variadic, list-flattened) dimension
 * arguments, reduced by canonical unit. Incomparable units (or a non-dimension
 * arg) leave the call as a CSS `min(...)` verbatim. Byte-faithful to Less 4.x
 * (`minMax`); see `list-helper.ts` for the shared kernel.
 */
export const min: Fn = {
  name: 'min',
  params: [{ kinds: ['Dimension'] }],
  variadic: true,
  body: (list) => minMax(true, asList(list)),
};
