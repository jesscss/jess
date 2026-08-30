import { unaryMath } from './math-helper.js';
import { defineFunction } from '@jesscss/core';
import type { Fn } from '@jesscss/core';

/** `atan(value)` — inverse tangent; result in `rad`. */
export const atan: Fn = defineFunction('atan', unaryMath(Math.atan, 'rad'));
