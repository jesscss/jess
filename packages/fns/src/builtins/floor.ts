import { unaryMath } from './math-helper.js';
import { defineFunction } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `floor(value)` — round DOWN; preserves the input unit. */
export const floor: Fn = defineFunction('floor', unaryMath(Math.floor, undefined));
