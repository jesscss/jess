import { unaryMath } from './math-helper.js';
import { defineFunction } from '@jesscss/core';
import type { Fn } from '@jesscss/core';

/** `tan(value)` — angle-normalized (deg/grad/turn → rad); unitless result. */
export const tan: Fn = defineFunction('tan', unaryMath(Math.tan, ''));
