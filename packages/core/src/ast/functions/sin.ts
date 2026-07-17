import { unaryMath } from './math-helper.js';
import type { Fn } from './types.js';

/** `sin(value)` — angle-normalized (deg/grad/turn → rad); unitless result. */
export const sin: Fn = { name: 'sin', ...unaryMath(Math.sin, '') };
