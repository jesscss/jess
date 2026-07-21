import { asList, minMax } from './list-helper.js';
import type { Fn } from '@jesscss/core/value';

/**
 * `max(v1, v2, …)` — the largest of the (variadic, list-flattened) dimension
 * arguments, reduced by canonical unit. Multiple surviving unit groups produce a
 * semantic CSS `max(...)` value; non-dimension input still throws at the shared
 * call boundary. See `list-helper.ts` for the shared kernel.
 */
export const max: Fn = {
  name: 'max',
  params: [{ kinds: ['Dimension'] }],
  variadic: true,
  body: (list, ctx) => minMax(false, asList(list), ctx.modes),
};
