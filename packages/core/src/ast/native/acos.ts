import { unaryMath } from './math-helper.js';
import type { NativeFn } from './types.js';

/** `acos(value)` — inverse cosine; result in `rad`. */
export const acos: NativeFn = { name: 'acos', ...unaryMath(Math.acos, 'rad') };
