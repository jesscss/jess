/**
 * The `sass:math` module variables (`math.$pi`, `math.$e`, …), Dart Sass's
 * values (`spec/core_functions/math/variables.hrx`). Less has `pi()`, a function
 * returning the same `Math.PI`, and none of the others.
 *
 * A module's non-function exports are its variables; the export name is the
 * variable name, so the hyphenated names are string export names.
 */
export const e = Math.E;
export const pi = Math.PI;
export const epsilon = Number.EPSILON;
const maxSafeInteger = Number.MAX_SAFE_INTEGER;
const minSafeInteger = Number.MIN_SAFE_INTEGER;
const maxNumber = Number.MAX_VALUE;
const minNumber = Number.MIN_VALUE;
export {
  maxSafeInteger as 'max-safe-integer',
  minSafeInteger as 'min-safe-integer',
  maxNumber as 'max-number',
  minNumber as 'min-number'
};
