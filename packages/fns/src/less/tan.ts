import { unaryMath } from '../shared/math/math-helper.js';
import { defineFunction } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `tan(value)` — angle-normalized (deg/grad/turn → rad); unitless result. */
export const tan: Fn = defineFunction('tan', unaryMath(Math.tan, ''));
