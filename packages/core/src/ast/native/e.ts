import { makeKeyword } from '../value-factory.js';
import type { NativeFn } from './types.js';

/** `e(value)` — escape a quoted value (drop quotes) → bare keyword; else pass through. */
export const e: NativeFn = {
  name: 'e',
  params: [{ kinds: 'any' }],
  body: (v) => (v.kind === 'quoted' ? makeKeyword(v.value) : v),
};
