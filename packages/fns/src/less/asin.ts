import { unaryMath } from '../shared/math/math-helper.js';
import { fitsNumber } from './css-math-args.js';
import { defineFunction } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `asin(value)` — inverse sine; result in `rad`. */
export const asin: Fn = defineFunction('asin', unaryMath(Math.asin, 'rad', fitsNumber));
