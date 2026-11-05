/**
 * Colour kernels whose math is the same in Less and Sass. A dialect's own
 * kernels (`less/color-helper.ts`, `sass/color/kernels.ts`) keep only what the
 * two disagree on: argument scale, clamping and format preservation.
 *
 * HARD MODULE BOUNDARY: value domain only.
 */
import type { Color, Dimension } from '@jesscss/core/value';
import { colorHsl, makeColorHsl } from '@jesscss/core/value';

/** Clamp to the 0-1 range (alpha, and an hsl channel written back). */
export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** `percentOf(base)`: a `%` dimension → `number * base / 100`; else its number. */
export const percentOf = (d: Dimension, base: number): number =>
  d.unit === '%' ? (d.number * base) / 100 : d.number;

/** A hue in degrees, wrapped into 0-360. */
export function wrapHue(degrees: number): number {
  const hue = degrees % 360;
  return hue < 0 ? hue + 360 : hue;
}

/**
 * Rotate hue by `degrees`, wrapped to 0-360, preserving alpha + format: Less's
 * `spin`, and Sass's `adjust-hue` and `complement` (`complement` is a fixed
 * 180). The two dialects differ only in how they read the amount — Less takes
 * the number, Sass converts an angle unit first.
 */
export function rotateHue(color: Color, degrees: number): Color {
  const [h, s, l] = colorHsl(color);
  return makeColorHsl([wrapHue(h + degrees), s, l], color.alpha, color.format);
}
