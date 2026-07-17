import { unaryMath } from './math-helper.js';
import type { NativeFn } from './types.js';

/** `cos(value)` — angle-normalized (deg/grad/turn → rad); unitless result. */
export const cos: NativeFn = { name: 'cos', ...unaryMath(Math.cos, '') };
