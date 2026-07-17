import { unaryMath } from './math-helper.js';
import type { NativeFn } from './types.js';

/** `percentage(value)` — `value * 100`, forced to `%`. */
export const percentage: NativeFn = { name: 'percentage', ...unaryMath((n) => n * 100, '%') };
