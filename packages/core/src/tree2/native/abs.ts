import { unaryMath } from './math-helper.js';
import type { NativeFn } from './types.js';

/** `abs(value)` — absolute value; preserves the input unit. */
export const abs: NativeFn = { name: 'abs', ...unaryMath(Math.abs, undefined) };
