import { unaryMath } from './math-helper.js';
import type { NativeFn } from './types.js';

/** `tan(value)` — angle-normalized (deg/grad/turn → rad); unitless result. */
export const tan: NativeFn = { name: 'tan', ...unaryMath(Math.tan, '') };
