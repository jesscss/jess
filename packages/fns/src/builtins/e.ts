import { makeKeyword } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `e(value)` — escape a quoted value (drop quotes) → bare keyword; else pass through. */
export const e: Fn = {
  name: 'e',
  params: [{ kinds: 'any' }],
  body: (v) => (v.type === 'Quoted' ? makeKeyword(v.value) : v),
};
