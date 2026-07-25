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
 * `min`/`max` ARE here. They are the CSS Values 4 math functions, so their
 * behaviour is CSS's and every dialect owes it identically; the earlier split
 * recorded a jess bug (a partial reduction matching neither lessc nor
 * dart-sass), not a real disagreement. The strict `math.min`/`math.max` remain
 * Sass-owned in `sass/math/`.
 */

// Math functions
export { default as abs } from './math/abs.js';
export { default as min } from './math/min.js';
export { default as max } from './math/max.js';
export { default as ceil } from './math/ceil.js';
export { default as floor } from './math/floor.js';

// Color functions
export { default as red } from './color/red.js';
export { default as green } from './color/green.js';
export { default as blue } from './color/blue.js';
export { default as alpha } from './color/alpha.js';
