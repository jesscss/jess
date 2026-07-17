import { unaryMath } from './math-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `ceil(value)` — round UP; preserves the input unit. */
export const ceil: Fn = { name: 'ceil', ...unaryMath(Math.ceil, undefined) };
