import { unaryMath } from '../shared/math/math-helper.js';
import { fitsAngle } from './css-math-args.js';
import { define } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `cos(value)` — angle-normalized (deg/grad/turn → rad); unitless result. */
export const cos: Fn = /* @__PURE__ */ define('cos', unaryMath(Math.cos, '', fitsAngle));
