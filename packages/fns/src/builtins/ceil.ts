import { unaryMath } from './math-helper.js';
import { defineFunction } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `ceil(value)` — round UP; preserves the input unit. */
export const ceil: Fn = defineFunction('ceil', unaryMath(Math.ceil, undefined));
