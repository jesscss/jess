import { unaryMath } from './math-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `asin(value)` — inverse sine; result in `rad`. */
export const asin: Fn = { name: 'asin', ...unaryMath(Math.asin, 'rad') };
