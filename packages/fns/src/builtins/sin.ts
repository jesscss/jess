import { unaryMath } from './math-helper.js';
import { defineFunction } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `sin(value)` — angle-normalized (deg/grad/turn → rad); unitless result. */
export const sin: Fn = defineFunction('sin', unaryMath(Math.sin, ''));
