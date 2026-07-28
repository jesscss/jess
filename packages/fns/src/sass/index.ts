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
export { abs, ceil, floor } from '../shared/index.js';
export { round } from './math/round.js';

/*
 * The GLOBAL `min`/`max` are Sass-owned: a bare call the engine preserves when
 * it fails. `math.min`/`math.max` (the module pair, whose failure reaches the
 * user) live in `./math/index.ts`.
 */
export { min } from './math/min.js';
export { max } from './math/max.js';
export { unitless } from './math/is-unitless.js';
export { comparable } from './math/compatible.js';
export { percentage } from './math/percentage.js';
export { unit } from './math/unit.js';
export { random } from './math/random.js';

// Global Color Functions (Deprecated - use color.* module instead)
// Every one of these is now a Sass-OWNED value-domain body in `sass/color/`,
// carrying the Sass dispatch name — nothing is re-exported from `less/`. The
// global name and the `sass:color` member name coincide for all of them; the
// four constructors (`rgb`/`rgba`/`hsl`/`hsla`) are globals only.
export { red, green, blue, alpha } from '../shared/index.js';
export {
  hue,
  saturation,
  lightness,
  opacity,
  grayscale,
  adjustHue,
  complement,
  invert,
  mix,
  lighten,
  darken,
  saturate,
  desaturate,
  opacify,
  fadeIn,
  transparentize,
  fadeOut,
  ieHexStr,
  rgb,
  rgba,
  hsl,
  hsla
} from './color/index.js';

/*
 * TODO: Implement remaining global color functions
 * - color()
 * - hwb()
 * - lab()
 * - lch()
 * - oklab()
 * - oklch()
 * - adjust-color()
 * - scale-color()
 * - change-color()
 */

// Global Meta Functions (Deprecated - use meta.* module instead)
export { typeOf } from './meta/type-of.js';

// Global String Functions (Deprecated - use string.* module instead)
export { default as unquote } from './unquote.js';
export { default as quote } from './quote.js';
export { default as toUpperCase } from './to-upper-case.js';
export { default as toLowerCase } from './to-lower-case.js';
export { default as uniqueId } from './unique-id.js';
export { default as strInsert } from './str-insert.js';
export { default as strIndex } from './str-index.js';
export { default as strSlice } from './str-slice.js';

/*
 * TODO: Implement remaining global string functions
 * - str-length() (use string.length instead)
 */

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

/*
 * Note: Module-specific functions are exported from their respective module files:
 * - import * as color from '@jesscss/fns/sass/color';
 * - import * as math from '@jesscss/fns/sass/math';
 * - import * as string from '@jesscss/fns/sass/string';
 * - import * as list from '@jesscss/fns/sass/list';
 * - import * as map from '@jesscss/fns/sass/map';
 */
