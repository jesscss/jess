/**
 * Sass color module (sass:color)
 *
 * Re-exports all color functions that are available in the sass:color module.
 * These are the modern, non-deprecated functions.
 *
 * Usage:
 * ```typescript
 * import { red, green, blue, alpha } from '@jesscss/fns/sass/color';
 * red(rgb(255, 0, 0)); // 255
 * ```
 */

// Color channel extractors (available in color module)
export { red, green, blue, alpha } from '../../shared/index.js';

// Color operations (available in color module)
// `mix`/`grayscale`/`ie-hex-str` currently resolve to the LESS implementation
// (directly or through a thin re-export in `sass/`), which carries the Less
// dispatch name and Less semantics. A dialect module never borrows another
// dialect's implementation, so they are absent here until Sass has its own.
export { default as invert } from '../invert.js'; // TODO: implement
export { default as complement } from '../complement.js'; // TODO: implement

// Color module-specific functions (not available globally)
export { default as hue } from '../hue.js';
export { default as saturation } from '../saturation.js';
export { default as lightness } from '../lightness.js';
export { default as opacity } from '../opacity.js';
// TODO: Implement remaining color module functions
// - color.whiteness()
// - color.blackness()
// - color.space()
// - color.to-space()
// - color.is-legacy()
// - color.is-missing()
// - color.is-in-gamut()
// - color.to-gamut()
// - color.channel()
// - color.same()
// - color.is-powerless()
// - color.adjust()
// - color.scale()
// - color.change()
// - color.hwb() (overloaded function)
// - color.opacity()
