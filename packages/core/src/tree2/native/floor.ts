import { unaryMath } from './math-helper.js';
import type { NativeFn } from './types.js';

/** `floor(value)` — round DOWN; preserves the input unit. */
export const floor: NativeFn = { name: 'floor', ...unaryMath(Math.floor, undefined) };
