import { unaryMath } from './math-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `tan(value)` — angle-normalized (deg/grad/turn → rad); unitless result. */
export const tan: Fn = { name: 'tan', ...unaryMath(Math.tan, '') };
