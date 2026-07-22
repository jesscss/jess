import { unaryMath } from './math-helper.js';
import { defineFunction } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `cos(value)` — angle-normalized (deg/grad/turn → rad); unitless result. */
export const cos: Fn = defineFunction('cos', unaryMath(Math.cos, ''));
