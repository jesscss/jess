/**
 * The COLOR model + byte-faithful color serializer for the value domain. Colorspace
 * math (hsl↔rgb) and scalar/hex emit for a `Color` value live here; dimension /
 * quoted / list emit stays in `serialize-value.ts`. Emit is FREE FUNCTIONS over
 * pure data — no node is constructed, no `render()` walk.
 *
 * HARD MODULE BOUNDARY: imports only the `Color` type + the shared `round` +
 * the shared output number policy.
 */
import type { Color } from './value-eval.js';
import { round } from './round.js';
import { formatNumber } from './format-number.js';

/* color-format enum, mirrored from tree/color.ts ColorFormat (opaque `number`). */
export const HEX = 0;
export const RGB = 1;
export const HSL = 2;

const clamp = (v: number, max: number): number => Math.min(Math.max(v, 0), max);

/** HSL(h deg, s 0-1, l 0-1) -> RGB 0-255, byte-identical to Color._rgb HSL branch. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = h / 360;
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) {
      t += 1;
    }
    if (t > 1) {
      t -= 1;
    }
    if (t < 1 / 6) {
      return p + (q - p) * 6 * t;
    }
    if (t < 1 / 2) {
      return q;
    }
    if (t < 2 / 3) {
      return p + (q - p) * (2 / 3 - t) * 6;
    }
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, hue + 1 / 3);
  const g = hue2rgb(p, q, hue);
  const b = hue2rgb(p, q, hue - 1 / 3);
  return [r * 255, g * 255, b * 255];
}

/** RGB 0-255 -> HSL(h deg, s 0-1, l 0-1), byte-identical to Color._hsl RGB branch. */
export function rgbToHsl(r0: number, g0: number, b0: number): [number, number, number] {
  const r = r0 / 255, g = g0 / 255, b = b0 / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h: number, s: number;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}

/**
 * The RAW (unrounded, unclamped) rgb SOURCE of a color — derived from `hsl` when
 * that is the source of truth, else the stored rgb. The single hsl-or-stored-rgb
 * selector that `colorRgb` (rounds/clamps on top) and the value factory both
 * consume; color arithmetic operates on this.
 */
export function colorSourceRgb(c: Color): [number, number, number] {
  return c.hsl ? hslToRgb(c.hsl[0], c.hsl[1], c.hsl[2]) : [c.rgb[0], c.rgb[1], c.rgb[2]];
}

/**
 * Concrete RGB (clamped 0-255, rounded) for a color — the value the legacy
 * `get rgb()` returns. Rounds/clamps the raw `colorSourceRgb`.
 */
export function colorRgb(c: Color): [number, number, number] {
  const [r, g, b] = colorSourceRgb(c);
  return [clamp(round(r), 255), clamp(round(g), 255), clamp(round(b), 255)];
}

/** Serialize a color to hex — `#rrggbb`, with a trailing `aa` byte when alpha < 1. */
function toHex(c: Color): string {
  const values = colorRgb(c) as number[];
  const alpha = clamp(c.alpha, 1);
  if (alpha < 1) {
    values.push(round(alpha * 255));
  }
  let out = '#';
  for (const v of values) {
    const hex = v.toString(16);
    out += hex.length === 1 ? `0${hex}` : hex;
  }
  return out;
}

/**
 * The serialized alpha text — the authored `%` spelling (`round(pct,8)%`) when the
 * alpha was written as a percent, else the decimal alpha under the shared output
 * number policy ({@link formatNumber}). The decimal branch used to emit the raw
 * double, safe only because `fns` happened to pre-round it.
 */
function alphaText(c: Color, a: number): string {
  return c.alphaPct !== undefined ? `${round(c.alphaPct, 8)}%` : formatNumber(a);
}

/**
 * Serialize a color in scalar syntax. A verbatim source literal (`c.src`) wins;
 * else format-based emit (RGB/HSL/HEX). The optional SOURCE-FORMAT state
 * (`rgbPct`/`alphaPct`/`hueUnit`) reproduces an un-operated constructor's authored
 * spelling (`%` channels, `%` alpha, hue unit); when absent the emit is the
 * canonical no-source branch (`${rgb[idx]}` / `${alpha}`).
 */
export function serializeColor(c: Color): string {
  if (c.src !== undefined) {
    return c.src;
  }
  const format = c.format ?? HEX;
  if (format === RGB) {
    const rgb = colorRgb(c);
    const pct = c.rgbPct;
    const chan = (idx: number): string =>
      pct?.[idx] !== undefined ? `${round(clamp(pct[idx]!, 100), 8)}%` : `${rgb[idx]}`;
    const r = chan(0), g = chan(1), b = chan(2);
    const a = clamp(c.alpha, 1);
    const modern = c.modernSyntax === true;
    if (modern) {
      return a < 1 ? `rgb(${r} ${g} ${b} / ${alphaText(c, a)})` : `rgb(${r} ${g} ${b})`;
    }
    return a < 1 ? `rgba(${r}, ${g}, ${b}, ${alphaText(c, a)})` : `rgb(${r}, ${g}, ${b})`;
  }
  if (format === HSL) {
    const [h, s, l] = c.hsl ?? rgbToHsl(c.rgb[0], c.rgb[1], c.rgb[2]);
    const a = clamp(c.alpha, 1);
    const roundedHue = round(h, 8);
    const S = round(clamp(s, 1) * 100, 8);
    const L = round(clamp(l, 1) * 100, 8);
    const modern = c.modernSyntax === true;

    /*
     * Legacy hue-unit rule: modern defaults to `deg` when unauthored; the
     * comma form preserves the authored unit (empty when unitless/derived).
     */
    const hueUnit = modern ? (c.hueUnit || 'deg') : (c.hueUnit ?? '');
    if (modern) {
      return a < 1 ? `hsl(${roundedHue}${hueUnit} ${S}% ${L}% / ${alphaText(c, a)})` : `hsl(${roundedHue}${hueUnit} ${S}% ${L}%)`;
    }
    return a < 1 ? `hsla(${roundedHue}${hueUnit}, ${S}%, ${L}%, ${alphaText(c, a)})` : `hsl(${roundedHue}${hueUnit}, ${S}%, ${L}%)`;
  }
  return toHex(c);
}
