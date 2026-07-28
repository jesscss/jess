import { defineFunction, emitValue, isValueGroupArray, makeAny } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `e(value)` — escape a value into opaque bytes emitted as-is. */
export const e: Fn = defineFunction('e', {
  params: [{ kinds: 'any' }],
  body: v => makeAny(!isValueGroupArray(v) && v.type === 'Quoted' ? v.value : emitValue(v))
});
