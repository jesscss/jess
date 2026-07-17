import { unaryMath } from './math-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `cos(value)` — angle-normalized (deg/grad/turn → rad); unitless result. */
export const cos: Fn = { name: 'cos', ...unaryMath(Math.cos, '') };
