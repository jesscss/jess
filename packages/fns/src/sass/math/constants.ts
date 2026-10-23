/**
 * The `sass:math` module variables, Dart Sass's values
 * (`spec/core_functions/math/variables.hrx`). Less has `pi()`, a function
 * returning the same `Math.PI`, and none of the others. A module's non-function
 * exports are its variables; the export name is the variable name.
 *
 * Not exported yet: `$max-safe-integer`, `$min-safe-integer`, `$max-number` and
 * `$min-number`. A hyphenated name needs a string export name
 * (`export { x as 'max-number' }`), which the published declarations cannot
 * carry: TypeScript before 5.6 cannot read them, and the oldest consumer
 * `verify:core-public-types` checks is 5.4.
 */
export const e = Math.E;
export const pi = Math.PI;
export const epsilon = Number.EPSILON;
