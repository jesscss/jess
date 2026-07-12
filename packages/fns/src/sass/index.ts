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
export { default as percentage } from './percentage.js';
export { default as unit } from './unit.js';
export { default as random } from './random.js';
// TODO: Implement remaining global math functions
// - comparable() (alias for math.compatible) - use compatible

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
export { default as uniqueId } from './unique-id.js';
export { default as strInsert } from './str-insert.js';
export { default as strIndex } from './str-index.js';
export { default as strSlice } from './str-slice.js';
// TODO: Implement remaining global string functions
// - str-length() (use string.length instead)

// Global List Functions (Deprecated - use list.* module instead)
export { default as length } from './list/length.js';
export { default as nth } from './list/nth.js';
export { default as index } from './list/list-index.js';
export { default as isBracketed } from './list/is-bracketed.js';
export { default as listSeparator } from './list/separator.js';
export { default as setNth } from './list/set-nth.js';
export { default as join } from './list/join.js';
export { default as append } from './list/append.js';
export { default as zip } from './list/zip.js';

// Global Map Functions (Deprecated - use map.* module instead)
export { default as mapGet } from './map/get.js';
export { default as mapMerge } from './map/merge.js';
export { default as mapRemove } from './map/remove.js';
export { default as mapKeys } from './map/keys.js';
export { default as mapValues } from './map/values.js';
export { default as mapHasKey } from './map/has-key.js';

// Note: Module-specific functions are exported from their respective module files:
// - import * as color from '@jesscss/fns/sass/color';
// - import * as math from '@jesscss/fns/sass/math';
// - import * as string from '@jesscss/fns/sass/string';
// - import * as list from '@jesscss/fns/sass/list';
// - import * as map from '@jesscss/fns/sass/map';
