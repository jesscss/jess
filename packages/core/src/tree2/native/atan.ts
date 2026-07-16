import { unaryMath } from './math-helper.js';
import type { NativeFn } from './types.js';

/** `atan(value)` — inverse tangent; result in `rad`. */
export const atan: NativeFn = { name: 'atan', ...unaryMath(Math.atan, 'rad') };
