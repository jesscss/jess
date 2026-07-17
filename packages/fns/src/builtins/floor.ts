import { unaryMath } from './math-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `floor(value)` — round DOWN; preserves the input unit. */
export const floor: Fn = { name: 'floor', ...unaryMath(Math.floor, undefined) };
