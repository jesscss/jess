import { unaryMath } from '../shared/math/math-helper.js';
import { fitsNumber } from './css-math-args.js';
import { define } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `asin(value)` — inverse sine; result in `rad`. */
export const asin: Fn = /* @__PURE__ */ define('asin', unaryMath(Math.asin, 'rad', fitsNumber));
