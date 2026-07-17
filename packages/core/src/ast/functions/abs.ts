import { unaryMath } from './math-helper.js';
import type { Fn } from './types.js';

/** `abs(value)` — absolute value; preserves the input unit. */
export const abs: Fn = { name: 'abs', ...unaryMath(Math.abs, undefined) };
