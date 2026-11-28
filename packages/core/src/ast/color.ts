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
import { convertValue } from './value-units.js';

/* color-format enum, mirrored from the legacy engine's ColorFormat (opaque `number`). */
export const HEX = 0;
export const RGB = 1;
export const HSL = 2;

/**
 * Whether a colour is written with a `none` channel, which a computed colour reads as 0 and a mix leaves to the browser.
 * TODO: read from a missing-channel mark set where `none` is parsed; a `Color` keeps no such field, so this reads its bytes.
 */
export const holdsNone = (color: Pick<Color, 'src'>): boolean => typeof color.src === 'string' && /\bnone\b/i.test(color.src);

export const clamp = (v: number, max: number): number => Math.min(Math.max(v, 0), max);

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

/**
 * `hwb()` to sRGB on 0–255 (css-color-4 §8): the hue's full colour scaled between
 * the whiteness and the blackness, whose sum at or above 1 is a grey.
 */
export function hwbToRgb(h: number, w: number, b: number): [number, number, number] {
  const sum = w + b;
  if (sum >= 1) {
    const grey = (w / sum) * 255;
    return [grey, grey, grey];
  }
  const [r, g, bl] = hslToRgb(h, 1, 0.5);
  const scale = 1 - sum;
  return [r * scale + w * 255, g * scale + w * 255, bl * scale + w * 255];
}

/** The hsl lightness, 0-1, of RGB 0-255: {@link rgbToHsl}'s `l` without the hue and saturation, for a reader of lightness alone. */
export const rgbLightness = (r: number, g: number, b: number): number => (Math.max(r, g, b) / 255 + Math.min(r, g, b) / 255) / 2;

/** RGB 0-255 -> HSL(h deg, s 0-1, l 0-1), byte-identical to Color._hsl RGB branch. */
export function rgbToHsl(r0: number, g0: number, b0: number): [number, number, number] {
  const r = r0 / 255, g = g0 / 255, b = b0 / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);

  /* The same `l` as rgbLightness, which lightness() reads alone; the two stay equal (color-lightness.test.ts). */
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
 * The RAW (unrounded, unclamped) rgb of a color, as a fresh triple. `colorRgb`
 * rounds/clamps on top; color arithmetic operates on this.
 */
export function colorSourceRgb(c: Color): [number, number, number] {
  return [c.rgb[0], c.rgb[1], c.rgb[2]];
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
 * The serialized alpha text — the authored `%` spelling when the alpha was written
 * as a percent, else the decimal alpha. BOTH branches go through the shared output
 * number policy ({@link formatNumber}); the percent branch used an 8-dp `round`,
 * which ruling V4 forbids (no fixed decimal-places rounding) and which annihilated
 * any percent below ~5e-9 to `0%`.
 */
function alphaText(c: Color, a: number, num: (v: number) => string): string {
  return c.alphaPct !== undefined ? `${num(c.alphaPct)}%` : num(a);
}

/** sRGB's transfer function, encoded to linear light (css-color-4 §10.2), odd about 0 for a channel out of gamut. */
export function srgbToLinear(c: number): number {
  const abs = Math.abs(c);
  return abs <= 0.04045 ? c / 12.92 : Math.sign(c) * Math.pow((abs + 0.055) / 1.055, 2.4);
}

/** Linear sRGB to CIE XYZ D65, row-major (Dart Sass 1.101.7 `conversions.dart`). */
export const LINEAR_SRGB_TO_XYZ_D65: readonly number[] = [0.4123907992659595, 0.35758433938387796, 0.1804807884018343, 0.21263900587151036, 0.7151686787677559, 0.07219231536073371, 0.01933081871559185, 0.11919477979462598, 0.9505321522496606];

/*
 * A colour in a CSS Color 4 space, in that space's function (css-color-4 §9,
 * §10.1): `lab()`/`oklab()` and `lch()`/`oklch()` with the lightness a
 * percentage and the hue in degrees, else `color(<space> …)`; `none` for a
 * missing channel (§4.4), the alpha only when it is not 1.
 *
 * A lab-family colour whose lightness is out of range, or an lch-family one
 * whose chroma is negative, would be clamped by its own function (§9.2), so it
 * is written as Dart Sass 1.101.7 writes it: its XYZ coordinates mixed in its
 * space, which keeps it the colour it is (`color-mix(in lab, color(xyz …) 100%, black)`).
 */
function spaceColorText(c: Color, space: string, [c0, c1, c2, alpha]: NonNullable<Color['channels']>, num: (v: number) => string, comma: string): string {
  const text = (v: number | null, unit = ''): string => v === null ? 'none' : `${num(v)}${unit}`;
  const tail = alpha === null ? ' / none' : alpha < 1 ? ` / ${num(alpha)}` : '';
  switch (space) {
    case 'lab':
    case 'lch':
    case 'oklab':
    case 'oklch': {
      const max = space[0] === 'o' ? 1 : 100;
      const clamped = (c0 !== null && c1 !== null && c2 !== null && (c0 < -1e-11 || c0 > max + 1e-11))
        || (space.endsWith('ch') && c0 !== null && c1 !== null && c1 < -1e-11);
      if (clamped) {
        const [r, g, b] = c.rgb.map(v => srgbToLinear(v / 255));
        const m = LINEAR_SRGB_TO_XYZ_D65;
        const xyz = [0, 3, 6].map(i => num(m[i]! * r! + m[i + 1]! * g! + m[i + 2]! * b!)).join(' ');
        return `color-mix(in ${space}${comma}color(xyz ${xyz}${tail}) 100%${comma}black)`;
      }
      const lightness = c0 === null ? null : space[0] === 'o' ? c0 * 100 : c0;
      return `${space}(${text(lightness, '%')} ${text(c1)} ${text(c2, space.endsWith('ch') ? 'deg' : '')}${tail})`;
    }
    default:
      return `color(${space} ${text(c0)} ${text(c1)} ${text(c2)}${tail})`;
  }
}

/**
 * Serialize a color in scalar syntax. A verbatim source literal (`c.src`) wins;
 * else format-based emit (RGB/HSL/HEX). The optional SOURCE-FORMAT state
 * (`rgbPct`/`alphaPct`/`hueUnit`) reproduces an un-operated constructor's authored
 * spelling (`%` channels, `%` alpha, hue unit); when absent the emit is the
 * canonical no-source branch (`${rgb[idx]}` / `${alpha}`).
 *
 * `num` spells each channel number and `comma` joins legacy comma-form
 * arguments; compressed output passes its own (`compress.ts` owns that spelling).
 */
export function serializeColor(c: Color, num: (v: number) => string = formatNumber, comma = ', '): string {
  if (c.src !== undefined) {
    return c.src;
  }
  if (c.channels !== undefined && c.space !== 'rgb' && c.space !== 'hsl' && c.space !== 'hwb') {
    return spaceColorText(c, c.space ?? 'srgb', c.channels, num, comma);
  }
  const format = c.format ?? HEX;
  if (format === RGB) {
    const rgb = colorRgb(c);
    const pct = c.rgbPct;
    const chan = (idx: number): string =>
      pct?.[idx] !== undefined ? `${num(clamp(pct[idx]!, 100))}%` : `${rgb[idx]}`;
    const r = chan(0), g = chan(1), b = chan(2);
    const a = clamp(c.alpha, 1);
    const modern = c.modernSyntax === true;
    if (modern) {
      return a < 1 ? `rgb(${r} ${g} ${b} / ${alphaText(c, a, num)})` : `rgb(${r} ${g} ${b})`;
    }
    return a < 1 ? `rgba(${r}${comma}${g}${comma}${b}${comma}${alphaText(c, a, num)})` : `rgb(${r}${comma}${g}${comma}${b})`;
  }
  if (format === HSL) {
    const [h, s, l] = c.hsl ?? rgbToHsl(c.rgb[0], c.rgb[1], c.rgb[2]);
    const a = clamp(c.alpha, 1);
    const hue = num(c.hueUnit === undefined || c.hueUnit === 'deg' ? h : convertValue(h, 'deg', c.hueUnit));
    const S = num(clamp(s, 1) * 100);
    const L = num(clamp(l, 1) * 100);
    const modern = c.modernSyntax === true;

    /*
     * Legacy hue-unit rule: modern defaults to `deg` when unauthored; the
     * comma form preserves the authored unit (empty when unitless/derived).
     */
    const hueUnit = modern ? (c.hueUnit || 'deg') : (c.hueUnit ?? '');
    if (modern) {
      return a < 1 ? `hsl(${hue}${hueUnit} ${S}% ${L}% / ${alphaText(c, a, num)})` : `hsl(${hue}${hueUnit} ${S}% ${L}%)`;
    }
    return a < 1
      ? `hsla(${hue}${hueUnit}${comma}${S}%${comma}${L}%${comma}${alphaText(c, a, num)})`
      : `hsl(${hue}${hueUnit}${comma}${S}%${comma}${L}%)`;
  }
  return toHex(c);
}
