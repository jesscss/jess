import { unaryMath } from './math-helper.js';
import type { Fn } from './types.js';

/** `tan(value)` — angle-normalized (deg/grad/turn → rad); unitless result. */
export const tan: Fn = { name: 'tan', ...unaryMath(Math.tan, '') };
