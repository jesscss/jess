import { unaryMath } from './math-helper.js';
import { defineFunction } from '@jesscss/core';
import type { Fn } from '@jesscss/core';

/** `cos(value)` — angle-normalized (deg/grad/turn → rad); unitless result. */
export const cos: Fn = defineFunction('cos', unaryMath(Math.cos, ''));
