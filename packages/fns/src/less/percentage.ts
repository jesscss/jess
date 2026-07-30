import { unaryMath } from './math-helper.js';
import { defineFunction } from '@jesscss/core';
import type { Fn } from '@jesscss/core';

/** `percentage(value)` — `value * 100`, forced to `%`. */
export const percentage: Fn = defineFunction('percentage', unaryMath(n => n * 100, '%'));
