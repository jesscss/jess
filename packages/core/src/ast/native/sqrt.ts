import { unaryMath } from './math-helper.js';
import type { NativeFn } from './types.js';

/** `sqrt(value)` — square root; preserves the input unit, NO angle normalization. */
export const sqrt: NativeFn = { name: 'sqrt', ...unaryMath(Math.sqrt, null) };
