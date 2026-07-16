import { unaryMath } from './math-helper.js';
import type { NativeFn } from './types.js';

/** `asin(value)` — inverse sine; result in `rad`. */
export const asin: NativeFn = { name: 'asin', ...unaryMath(Math.asin, 'rad') };
