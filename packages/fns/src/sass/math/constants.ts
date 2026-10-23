/**
 * The `sass:math` module variables, Dart Sass's values
 * (`spec/core_functions/math/variables.hrx`). Less has `pi()`, a function
 * returning the same `Math.PI`, and none of the others. A module's non-function
 * exports are its variables; the export name is the variable name.
 *
 * A JS identifier cannot spell a hyphenated name, so those variables are entries
 * of the module's member table, `$members`, which the module binder reads as
 * members under their own keys (`@jesscss/core` `MEMBER_TABLE`).
 */
export const e = Math.E;
export const pi = Math.PI;
export const epsilon = Number.EPSILON;

/* eslint-disable @typescript-eslint/naming-convention -- the binder's member-table export, keyed by Sass variable names. */
export const $members = {
  'max-safe-integer': Number.MAX_SAFE_INTEGER,
  'min-safe-integer': Number.MIN_SAFE_INTEGER,
  'max-number': Number.MAX_VALUE,
  'min-number': Number.MIN_VALUE
} as const;
/* eslint-enable @typescript-eslint/naming-convention */
