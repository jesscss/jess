import { defineFunction, makeBool } from '@jesscss/core/value';
import { isUnitlessDimension } from './units.js';

/**
 * Sass `math.is-unitless($number)`, exposed globally as `unitless()`.
 *
 * Verified against dart-sass 1.101.0:
 *   unitless(10)            → true
 *   unitless(10px)          → false
 *   unitless(10%)           → false
 *   math.is-unitless(1px * 1px) → false
 *   unitless("a")           → Error: $number: "a" is not a number.
 */
const isUnitless = defineFunction('is-unitless', {
  params: [{ name: 'number', kinds: ['Dimension'] }] as const,
  body: number => makeBool(isUnitlessDimension(number))
});

/** The deprecated global spelling of {@link isUnitless}. Same body, Sass's global name. */
const unitless = defineFunction('unitless', {
  params: [{ name: 'number', kinds: ['Dimension'] }] as const,
  body: number => makeBool(isUnitlessDimension(number))
});

export { isUnitless, unitless };
export default isUnitless;
