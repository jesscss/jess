import { unaryMath } from './math-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `sqrt(value)` — square root; preserves the input unit, NO angle normalization. */
export const sqrt: Fn = { name: 'sqrt', ...unaryMath(Math.sqrt, null) };
