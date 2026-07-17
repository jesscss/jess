import { unaryMath } from './math-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `percentage(value)` — `value * 100`, forced to `%`. */
export const percentage: Fn = { name: 'percentage', ...unaryMath((n) => n * 100, '%') };
