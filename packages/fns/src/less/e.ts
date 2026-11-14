import { emitValue, isValueGroupArray, makeAny, define, checkAny } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/**
 * `e(value)` — escape a value into opaque bytes emitted as-is. The result is an
 * escaped string, written with `"` as Less 4.x writes it.
 */
export const e: Fn = /* @__PURE__ */ define('e', {
  params: [{ type: 'any', check: checkAny }],
  body: v => makeAny(!isValueGroupArray(v) && v.type === 'Quoted' ? v.value : emitValue(v), '"')
});
