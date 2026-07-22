import { unaryMath } from './math-helper.js';
import { defineFunction } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `atan(value)` — inverse tangent; result in `rad`. */
export const atan: Fn = defineFunction('atan', unaryMath(Math.atan, 'rad'));
