import { defineFunction, makeDimension } from '@jesscss/core';
import { applyMath } from '../../shared/math/math-helper.js';
import { assertAngle, assertNoUnits, convertToMatch } from './units.js';

/*
 * Sass `math.sin`/`cos`/`tan`/`asin`/`acos`/`atan`/`atan2`.
 *
 * The computation is Less's: `applyMath` reads `deg`/`grad`/`turn` as radians and
 * a unitless number or `rad` as it stands. What differs is the unit rule:
 *
 *   - Less reads any other unit as radians (`sin(1px)` is `sin(1)`); Dart Sass
 *     accepts an angle or a unitless number only:
 *       math.sin(1deg) → 0.0174524064    math.sin(1) → 0.8414709848
 *       math.sin(1px)  → Error: $number: Expected 1px to have an angle unit (deg, grad, rad, turn).
 *   - Less's inverse trig answers in `rad`; Dart Sass's in `deg`, from a unitless
 *     argument only:
 *       math.asin(0.5) → 30deg           math.atan(1) → 45deg
 *       math.asin(1px) → Error: $number: Expected 1px to have no units.
 *
 * `atan2` has no Less counterpart. Its `$x` is converted to `$y`'s units, so a
 * unitless and a unit'd argument do not mix:
 *   math.atan2(1, -1)        → 135deg
 *   math.atan2(1cm, -10mm)   → 135deg
 *   math.atan2(1px, 1)       → Error: $x: 1 and $y: 1px have incompatible units (one has units and the other doesn't).
 * (sass-spec `core_functions/math/{sin,cos,tan,asin,acos,atan}.hrx`, `atan2/**`.)
 */

/** Dart Sass's radians-to-degrees factor (`180 / pi`). */
const DEGREES = 180 / Math.PI;

const params = [{ name: 'number', type: 'Dimension' }] as const;

const sin = defineFunction('sin', { params, body: number => applyMath(Math.sin, '', [assertAngle(number, 'number')]) });
const cos = defineFunction('cos', { params, body: number => applyMath(Math.cos, '', [assertAngle(number, 'number')]) });
const tan = defineFunction('tan', { params, body: number => applyMath(Math.tan, '', [assertAngle(number, 'number')]) });

const asin = defineFunction('asin', {
  params,
  body: number => applyMath(n => Math.asin(n) * DEGREES, 'deg', [assertNoUnits(number, 'number')])
});
const acos = defineFunction('acos', {
  params,
  body: number => applyMath(n => Math.acos(n) * DEGREES, 'deg', [assertNoUnits(number, 'number')])
});
const atan = defineFunction('atan', {
  params,
  body: number => applyMath(n => Math.atan(n) * DEGREES, 'deg', [assertNoUnits(number, 'number')])
});

const atan2 = defineFunction('atan2', {
  params: [
    { name: 'y', type: 'Dimension' },
    { name: 'x', type: 'Dimension' }
  ] as const,
  body: (y, x) => makeDimension(Math.atan2(y.number, convertToMatch(x, y, '$x', '$y')) * DEGREES, 'deg')
});

export { sin, cos, tan, asin, acos, atan, atan2 };
