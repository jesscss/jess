/**
 * Sass math module (sass:math)
 * 
 * Re-exports all math functions that are available in the sass:math module.
 * These are the modern, non-deprecated functions.
 * 
 * Usage:
 * ```typescript
 * import { abs, ceil, floor } from '@jesscss/fns/sass/math';
 * abs(-10px); // 10px
 * ```
 */

// Math functions (available in math module)
export { abs, ceil, floor, round, max, min } from '../../shared/index.js';
export { default as unitless } from '../unitless.js';
export { default as compatible } from '../compatible.js';
// TODO: Implement remaining math module functions
// - math.percentage()
// - math.unit()
// - math.sqrt()
// - math.pow()
// - math.log()
// - math.hypot()
// - math.sin()
// - math.cos()
// - math.tan()
// - math.asin()
// - math.acos()
// - math.atan()
// - math.atan2()
// - math.clamp()
// - math.div()

// Math module variables (constants)
// TODO: Implement as variables or functions
// - math.$e
// - math.$pi
// - math.$epsilon
// - math.$max-safe-integer
// - math.$min-safe-integer
// - math.$max-number
// - math.$min-number
