/**
 * Shared kernels for the native COLOR-CONSTRUCTOR fns (`rgb`/`hsl`/`hsv`/… + their
 * `*a` aliases). Boundary-clean re-implementations of the legacy `@jesscss/core`
 * conversion plugins (`percentOf` / `normalizeHue` / `alphaToNumber`) over the
 * value-domain `Dimension` — NO `../conversions` import (that reaches `../tree`).
 *
 * HARD MODULE BOUNDARY: value domain only.
 */
import type { Dimension, List, ValueObj } from '../value-eval.js';

/** Clamp to the 0-1 range (alpha / saturation / lightness). */
export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** `percentOf(base)`: a `%` dimension → `number * base / 100`; else its number. */
export const percentOf = (d: Dimension, base: number): number =>
  d.unit === '%' ? (d.number * base) / 100 : d.number;

/**
 * `normalizeHue()`: any angle unit → degrees wrapped to 0-360. `turn`/`rad`/`grad`/
 * `%` convert; `deg`/unitless pass through; an unrecognized unit stays raw (legacy
 * parity: it returns the value unconverted, so we keep the number).
 */
export function normalizeHue(d: Dimension): number {
  const { number, unit } = d;
  let deg: number;
  switch (unit) {
    case 'turn': deg = number * 360; break;
    case 'rad': deg = (number * 180) / Math.PI; break;
    case 'grad': deg = number * 0.9; break;
    case '%': deg = (number * 360) / 100; break;
    case '':
    case 'deg': deg = number; break;
    default: return number;
  }
  return ((deg % 360) + 360) % 360;
}

/** `alphaToNumber()`: a `%` dimension → `number / 100`; unitless passes; clamp 0-1. */
export function alphaToNumber(d: Dimension): number {
  const raw = d.unit === '%' ? d.number / 100 : d.unit === '' ? d.number : d.number;
  return Math.max(0, Math.min(1, raw));
}

/** Whether an arg-list item is a materialized color operand. */
export const isColor = (v: ValueObj | undefined): boolean => v?.kind === 'color';

/** Modern color syntax is signalled by a space / slash separated call. */
export const isModern = (list: List): boolean => list.sep === ' ' || list.sep === '/';

/**
 * The HSV→RGB kernel shared by `hsv`/`hsva` — byte-faithful to legacy `less/hsva`.
 * `h` in degrees, `s`/`v` in 0-1; returns the raw (unrounded) 0-255 rgb triple.
 */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hue = ((h % 360) / 360) * 360;
  const i = Math.floor((hue / 60) % 6);
  const f = hue / 60 - i;
  const vs = [v, v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)];
  const perm = [
    [0, 3, 1],
    [2, 0, 1],
    [1, 0, 3],
    [1, 2, 0],
    [3, 1, 0],
    [0, 1, 2],
  ];
  const p = perm[i]!;
  return [vs[p[0]!]! * 255, vs[p[1]!]! * 255, vs[p[2]!]! * 255];
}
