/**
 * The Less dialect index — the SINGLE registration unit for Less built-ins.
 *
 * Composition rule (owner spec): a dialect index exports what lives in its own
 * folder PLUS the entries of `shared/` that this dialect actually has. There is
 * no separate assembly list, no merged registry, and no fallback chain: what a
 * dialect exports here is exactly what `makeLessRegistry()` registers.
 *
 * Adding a Less fn is therefore ONE edit beyond the module itself — a line in
 * this index. Nothing else enumerates the set.
 *
 * `shared/` carries only fns whose behaviour is identical in Less and Sass.
 *
 * `if`/`boolean`/`not`/`and`/`or`, `isdefined`, `isruleset` and `each` are NOT
 * here: core special-forms all of them during serialization
 * (`serialize.ts:3207`, `:3215`, `LOGICAL_FNS` at `:3326`), so a fn module for
 * them was dead code in the compiled path and is deleted.
 */

/** Math — shared with Sass (identical behaviour). */
export { abs, ceil, floor } from '../shared/index.js';

/** Math — Less-specific. */
export { round } from './round.js';
export { sqrt } from './sqrt.js';
export { pow } from './pow.js';
export { mod } from './mod.js';
export { pi } from './pi.js';
export { percentage } from './percentage.js';
export { unit } from './unit.js';
export { getUnit } from './get-unit.js';
export { convert } from './convert.js';

/** Math — trigonometry. */
export { sin } from './sin.js';
export { cos } from './cos.js';
export { tan } from './tan.js';
export { asin } from './asin.js';
export { acos } from './acos.js';
export { atan } from './atan.js';

/** Lists. `min`/`max` are Less-specific (Sass compares display numbers). */
export { range } from './range.js';
export { default as length } from './length.js';
export { default as extract } from './extract.js';
export { min } from './min.js';
export { max } from './max.js';

/** Colour — channel getters shared with Sass (identical behaviour). */
export { red, green, blue, alpha } from '../shared/index.js';

/** Colour — HSL/alpha adjusters. */
export { lighten } from './lighten.js';
export { darken } from './darken.js';
export { saturate } from './saturate.js';
export { desaturate } from './desaturate.js';
export { spin } from './spin.js';
export { greyscale } from './greyscale.js';
export { fade } from './fade.js';
export { fadein } from './fadein.js';
export { fadeout } from './fadeout.js';

/** Colour — mixers. */
export { mix } from './mix.js';
export { tint } from './tint.js';
export { shade } from './shade.js';

/** Colour — readers. */
export { hue } from './hue.js';
export { saturation } from './saturation.js';
export { lightness } from './lightness.js';
export { luma } from './luma.js';
export { luminance } from './luminance.js';
export { hsvhue } from './hsvhue.js';
export { hsvsaturation } from './hsvsaturation.js';
export { hsvvalue } from './hsvvalue.js';
export { contrast } from './contrast.js';

/** Colour — blend modes. */
export { multiply } from './multiply.js';
export { screen } from './screen.js';
export { overlay } from './overlay.js';
export { softlight } from './softlight.js';
export { hardlight } from './hardlight.js';
export { difference } from './difference.js';
export { exclusion } from './exclusion.js';
export { average } from './average.js';
export { negation } from './negation.js';

/** Colour — constructors / string producers. */
export { rgb } from './rgb.js';
export { rgba } from './rgba.js';
export { hsl } from './hsl.js';
export { hsla } from './hsla.js';
export { hsv } from './hsv.js';
export { hsva } from './hsva.js';
export { argb } from './argb.js';
export { color } from './color.js';

/** Strings. */
export { replace } from './replace.js';
export { format, formatPercent } from './format.js';
export { escape } from './escape.js';
export { e } from './e.js';

/** Type-introspection predicates. */
export {
  iscolor, isnumber, isstring, iskeyword, isunit, ispixel, ispercentage, isem
} from './types.js';

/** URL / IO producers. */
export { default as svgGradient } from './svg-gradient.js';
export { default as dataUri } from './data-uri.js';
export { imageSize } from './image-size.js';
export { imageWidth } from './image-width.js';
export { imageHeight } from './image-height.js';
