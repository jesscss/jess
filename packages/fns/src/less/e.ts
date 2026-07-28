import { defineFunction, emitValue, isValueGroupArray, makeAnonymous } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `e(value)` — escape a value into raw unquoted bytes. */
export const e: Fn = defineFunction('e', {
  params: [{ kinds: 'any' }],
  body: v => makeAnonymous(!isValueGroupArray(v) && v.type === 'Quoted' ? v.value : emitValue(v))
});
