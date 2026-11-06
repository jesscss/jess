/**
 * Colour kernels whose math is the same in Less and Sass. A dialect's own
 * kernels (`less/color-helper.ts`, `sass/color/kernels.ts`) keep only what the
 * two disagree on: argument scale, clamping and format preservation.
 *
 * HARD MODULE BOUNDARY: value domain only.
 */
import type { Color, Dimension } from '@jesscss/core/value';

/** Clamp to the 0-1 range (alpha, and an hsl channel written back). */
export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** `percentOf(base)`: a `%` dimension → `number * base / 100`; else its number. */
export const percentOf = (d: Dimension, base: number): number =>
  d.unit === '%' ? (d.number * base) / 100 : d.number;
