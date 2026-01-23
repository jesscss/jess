/**
 * Sass global functions (legacy/deprecated)
 * 
 * These are the global functions that Sass provides for backward compatibility.
 * They are deprecated in favor of module-specific functions (e.g., use math.abs() instead of abs()).
 * 
 * Usage:
 * ```typescript
 * import { abs, red, mix } from '@jesscss/fns/sass';
 * abs(-10px); // 10px
 * ```
 */

// Global Math Functions (Deprecated - use math.* module instead)
export { abs, ceil, floor, round, max, min } from '../shared/index.js';
export { default as unitless } from './unitless.js';
export { default as compatible } from './compatible.js';
// TODO: Implement remaining global math functions
// - percentage()
// - unit()
// - comparable() (alias for math.compatible) - use compatible
// - random()

// Global Color Functions (Deprecated - use color.* module instead)
export { red, green, blue, alpha } from '../shared/index.js';
export { default as mix } from '../less/mix.js';
export { default as rgb } from '../less/rgb.js';
export { default as rgba } from '../less/rgba.js';
export { default as hsl } from '../less/hsl.js';
export { default as hsla } from '../less/hsla.js';
export { default as lighten } from '../less/lighten.js';
export { default as darken } from '../less/darken.js';
export { default as saturate } from '../less/saturate.js';
export { default as desaturate } from '../less/desaturate.js';
export { default as grayscale } from './grayscale.js';
export { default as adjustHue } from './adjust-hue.js';
export { default as opacify } from './opacify.js';
export { default as fadeIn } from './fade-in.js';
export { default as transparentize } from './transparentize.js';
export { default as fadeOut } from './fade-out.js';
export { default as complement } from './complement.js'; // TODO: implement
export { default as ieHexStr } from './ie-hex-str.js';
export { default as invert } from './invert.js'; // TODO: implement
export { default as hue } from './hue.js';
export { default as saturation } from './saturation.js';
export { default as lightness } from './lightness.js';
export { default as opacity } from './opacity.js';
// TODO: Implement remaining global color functions
// - color()
// - hwb()
// - lab()
// - lch()
// - oklab()
// - oklch()
// - adjust-color()
// - scale-color()
// - change-color()

// Global String Functions (Deprecated - use string.* module instead)
export { default as unquote } from './unquote.js';
export { default as quote } from './quote.js';
export { default as toUpperCase } from './to-upper-case.js';
export { default as toLowerCase } from './to-lower-case.js';
// TODO: Implement remaining global string functions
// - unique-id()
// - str-length() (use string.length instead)
// - str-insert()
// - str-index()
// - str-slice()

// Global List Functions (Deprecated - use list.* module instead)
// TODO: Implement global list functions
// - length()
// - nth()
// - set-nth()
// - join()
// - append()
// - zip()
// - index()
// - is-bracketed()
// - list-separator()

// Global Map Functions (Deprecated - use map.* module instead)
// TODO: Implement global map functions
// - map-get()
// - map-merge()
// - map-remove()
// - map-keys()
// - map-values()
// - map-has-key()

// Note: Module-specific functions are exported from their respective module files:
// - import * as color from '@jesscss/fns/sass/color';
// - import * as math from '@jesscss/fns/sass/math';
// - import * as string from '@jesscss/fns/sass/string';
// - import * as list from '@jesscss/fns/sass/list';
// - import * as map from '@jesscss/fns/sass/map';
