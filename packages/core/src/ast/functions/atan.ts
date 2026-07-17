import { unaryMath } from './math-helper.js';
import type { Fn } from './types.js';

/** `atan(value)` — inverse tangent; result in `rad`. */
export const atan: Fn = { name: 'atan', ...unaryMath(Math.atan, 'rad') };
