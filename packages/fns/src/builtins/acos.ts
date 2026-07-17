import { unaryMath } from './math-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `acos(value)` — inverse cosine; result in `rad`. */
export const acos: Fn = { name: 'acos', ...unaryMath(Math.acos, 'rad') };
