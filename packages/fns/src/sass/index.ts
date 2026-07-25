/**
 * The Sass dialect index — the SINGLE registration unit for Sass globals.
 *
 * Composition rule (owner spec): a dialect index exports what lives in its own
 * folder PLUS the entries of `shared/` that this dialect actually has. It is
 * both the importable module surface and what `registryOf()` registers; nothing
 * merges it with another dialect and there is no fallback to Less.
 *
 * These are Sass's global (deprecated) functions; the module-specific sets live
 * in `sass/color`, `sass/list`, `sass/map`, `sass/math` and `sass/string`.
 *
 * Most entries here are still in the LEGACY tree-node domain. They stay part of
 * this module's JavaScript-callable surface but are not value-domain `Fn`s, so
 * registration skips them — converting one in place is what registers it. That
 * is why an unconverted Sass global currently has NO built-in implementation
 * rather than silently inheriting the Less one.
 *
 * Usage:
 * ```typescript
 * import { abs, red } from '@jesscss/fns/sass';
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
// `mix`/`rgb`/`rgba`/`hsl`/`hsla`/`lighten`/`darken`/`saturate`/`desaturate`:
// Sass's semantics differ from Less's, and `sass/` has no implementation of its
// own yet. A dialect index never borrows another dialect's implementation, so
// these are simply absent until they are written here (tracked port work).
// `grayscale`/`adjust-hue`/`opacify`/`fade-in`/`transparentize`/`fade-out`/
// `ie-hex-str`: the modules in this folder are thin re-exports of the LESS
// implementation, which carries the Less dispatch name. Registering them here
// would publish a Less built-in under Sass, so they are excluded until a Sass
// implementation (or an explicit alias mechanism) exists — both tracked.
export { default as complement } from './complement.js'; // TODO: implement
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
