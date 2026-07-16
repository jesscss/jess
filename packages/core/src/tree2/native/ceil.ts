import { unaryMath } from './math-helper.js';
import type { NativeFn } from './types.js';

/** `ceil(value)` — round UP; preserves the input unit. */
export const ceil: NativeFn = { name: 'ceil', ...unaryMath(Math.ceil, undefined) };
