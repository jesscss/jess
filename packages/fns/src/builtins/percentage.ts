import { unaryMath } from './math-helper.js';
import { defineFunction } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `percentage(value)` — `value * 100`, forced to `%`. */
export const percentage: Fn = defineFunction('percentage', unaryMath(n => n * 100, '%'));
