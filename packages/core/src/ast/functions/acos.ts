import { unaryMath } from './math-helper.js';
import type { Fn } from './types.js';

/** `acos(value)` — inverse cosine; result in `rad`. */
export const acos: Fn = { name: 'acos', ...unaryMath(Math.acos, 'rad') };
