import { unaryMath } from './math-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `atan(value)` — inverse tangent; result in `rad`. */
export const atan: Fn = { name: 'atan', ...unaryMath(Math.atan, 'rad') };
