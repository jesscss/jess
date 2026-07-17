import { unaryMath } from './math-helper.js';
import type { Fn } from './types.js';

/** `asin(value)` — inverse sine; result in `rad`. */
export const asin: Fn = { name: 'asin', ...unaryMath(Math.asin, 'rad') };
