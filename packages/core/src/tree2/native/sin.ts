import { unaryMath } from './math-helper.js';
import type { NativeFn } from './types.js';

/** `sin(value)` — angle-normalized (deg/grad/turn → rad); unitless result. */
export const sin: NativeFn = { name: 'sin', ...unaryMath(Math.sin, '') };
