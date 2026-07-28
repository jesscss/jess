/**
 * Functions whose behaviour is IDENTICAL in Less and Sass.
 *
 * Identical behaviour is the only criterion for living here — same name is not
 * identical, same purpose is not identical. If the dialects disagree on the
 * result for any input in the domain (return type, unit, rounding, coercion,
 * arity, error case, list handling, output format), it belongs in the dialect
 * folders as two implementations.
 *
 * Deliberately NOT here: `round` (Less takes decimal precision, Sass a step to
 * round to a multiple of) — dialect-owned.
 *
 * `min`/`max` are NOT here: Less coerces a unitless argument into the reference
 * unit and compares canonically, Sass compares display numbers, so
 * `max(1px, 1in, 2)` is `1in` in one and `2` in the other. Each dialect keeps
 * its own body. `shared/math/units.ts` IS shared — unit compatibility is a
 * property of CSS units and both need it.
 */

// Math functions
export { default as abs } from './math/abs.js';
export { default as ceil } from './math/ceil.js';
export { default as floor } from './math/floor.js';

// Color functions
export { default as red } from './color/red.js';
export { default as green } from './color/green.js';
export { default as blue } from './color/blue.js';
export { default as alpha } from './color/alpha.js';
