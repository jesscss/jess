import { asList, minMax } from './list-helper.js';
import type { Fn } from '@jesscss/core/value';

/**
 * `min(v1, v2, …)` — the smallest of the (variadic, list-flattened) dimension
 * arguments, reduced by canonical unit. Multiple surviving unit groups produce a
 * semantic CSS `min(...)` value; non-dimension input still throws at the shared
 * call boundary. See `list-helper.ts` for the shared kernel.
 */
export const min: Fn = {
  name: 'min',
  params: [{ kinds: ['Dimension'] }],
  variadic: true,
  body: (list, ctx) => minMax(true, asList(list), ctx.modes),
};
