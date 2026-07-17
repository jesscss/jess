import { unaryMath } from './math-helper.js';
import type { Fn } from './types.js';

/** `ceil(value)` — round UP; preserves the input unit. */
export const ceil: Fn = { name: 'ceil', ...unaryMath(Math.ceil, undefined) };
