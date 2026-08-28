import { unaryMath } from './math-helper.js';
import { defineFunction } from '@jesscss/core';
import type { Fn } from '@jesscss/core';

/** `sqrt(value)` — square root; preserves the input unit, NO angle normalization. */
export const sqrt: Fn = defineFunction('sqrt', unaryMath(Math.sqrt, null));
