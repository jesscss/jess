import { defineFunction, emitValue, isValueGroupArray, makeAny } from '@jesscss/core';
import type { Fn } from '@jesscss/core';

/**
 * `e(value)` — escape a value into opaque bytes emitted as-is. The result is an
 * escaped string, written with `"` as Less 4.x writes it.
 */
export const e: Fn = defineFunction('e', {
  params: [{ type: 'any' }],
  body: v => makeAny(!isValueGroupArray(v) && v.type === 'Quoted' ? v.value : emitValue(v), '"')
});
