/**
 * `sass:color` — the Sass colour module.
 *
 * Every member here is a value-domain `Fn` carrying its SASS dispatch name, so
 * the dialect index that re-exports this folder registers Sass's colour set and
 * nothing borrowed. Where a Sass function happens to compute what a Less one
 * computes (`grayscale`/`greyscale`, `adjust-hue`/`spin`) the body is restated
 * under the Sass name rather than re-exported: a fn IS its name, and registering
 * the Less callable would publish a Less built-in under a Sass module.
 *
 * `red`/`green`/`blue`/`alpha` stay in `shared/` — the colour-precision ruling
 * (full precision internally, quantization only at the output boundary) makes
 * the two dialects' readers the same function.
 *
 * Verification source: `sass-spec/spec/core_functions/color/**` (pinned at
 * `f282e3844`), driven at the value-domain level by
 * `sass/__tests__/color-sass-spec.test.ts`. Where a spec case asserts an 8-bit
 * ROUNDED channel, that is dart-sass's legacy colour model and is recorded as a
 * finding, not matched.
 */

// Channel readers shared with Less (identical behaviour under the precision ruling).
export { red, green, blue, alpha } from '../../shared/index.js';

// Channel readers that are Sass-owned (`hue` returns degrees; Less returns unitless).
export { hue } from './hue.js';
export { saturation } from './saturation.js';
export { lightness } from './lightness.js';
export { opacity } from './opacity.js';

// Colour transforms.
export { grayscale } from './grayscale.js';
export { adjustHue } from './adjust-hue.js';
export { complement } from './complement.js';
export { invert } from './invert.js';
export { mix } from './mix.js';
export { lighten } from './lighten.js';
export { darken } from './darken.js';
export { saturate } from './saturate.js';
export { desaturate } from './desaturate.js';

// Alpha transforms — Sass's 0-1 fraction scale, NOT Less's percentage scale.
export { opacify } from './opacify.js';
export { fadeIn } from './fade-in.js';
export { transparentize } from './transparentize.js';
export { fadeOut } from './fade-out.js';

// Output formatting.
export { ieHexStr } from './ie-hex-str.js';

// Constructors. These are Sass GLOBALS rather than `sass:color` members
// (`meta.module-functions("color")` does not list them), but they are colour
// construction and belong to this folder; the dialect index decides the surface.
export { rgb } from './rgb.js';
export { rgba } from './rgba.js';
export { hsl } from './hsl.js';
export { hsla } from './hsla.js';

// Not implemented — each needs a colour-space model jess does not have yet:
// color.hwb / lab / lch / oklab / oklch, color.space / to-space / channel /
// same / is-legacy / is-missing / is-in-gamut / to-gamut / is-powerless,
// color.whiteness / blackness, color.adjust / scale / change.
