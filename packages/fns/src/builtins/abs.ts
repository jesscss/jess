import { unaryMath } from './math-helper.js';
import { defineFunction } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `abs(value)` — absolute value; preserves the input unit. */
export const abs: Fn = defineFunction('abs', unaryMath(Math.abs, undefined));
