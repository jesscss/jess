/**
 * Shared functions between Less and Sass
 * 
 * These functions have identical behavior in both Less and Sass,
 * so they are implemented once and re-exported by both libraries.
 */

// Math functions
export { default as abs } from './math/abs.js';
export { default as ceil } from './math/ceil.js';
export { default as floor } from './math/floor.js';
export { default as round } from './math/round.js';
export { default as max } from './math/max.js';
export { default as min } from './math/min.js';

// Color functions
export { default as red } from './color/red.js';
export { default as green } from './color/green.js';
export { default as blue } from './color/blue.js';
export { default as alpha } from './color/alpha.js';
