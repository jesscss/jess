/**
 * Shared color kernels the color fns reduce to — the color-domain twin of
 * `math-helper.ts`. Pure functions over the tree2 value `Color`: the Sass-derived
 * `mixColors` weight blend, WCAG `getLuma`, and `toHsv`. Byte-faithful ports of
 * `@jesscss/fns`'s `mix` / `util/get-luma` / `util/to-hsv`.
 *
 * HARD MODULE BOUNDARY: value domain only (no `../tree`, no legacy node).
 */
import { HEX, RGB, colorHsl, colorRawRgb, colorRgbRounded, makeColorHsl, makeColorRgb, serializeColor, textOf, type Color, type Value } from '@jesscss/core';
import { clamp01 } from './color-ctor-helper.js';
import { requireDimension } from './math-helper.js';

export function requireColor(value: Value): Color {
  if (value.type !== 'Color') {
    throw new TypeError('Expected a color value.');
  }
  return value;
}

/**
 * Rebuild `c` re-tagged to `format`, recomputing its serialized bytes (mirrors
 * `makeColorRgb`'s self-serialize). The reformat-to-input-format dance the
 * format-preserving fns (`contrast`/`tint`/`shade`) share.
 */
export function reformatColor(c: Color, format: number): Color {
  const base: Color = { ...c, format, bytes: '' };
  return { ...base, bytes: serializeColor(base) };
}

/** Collapse a hair's-breadth-of-1 alpha (mix float drift) back to exactly 1. */
export const snapAlpha = (a: number): number => (Math.abs(a - 1) < 1e-12 ? 1 : a);

/**
 * The one alpha-adjust kernel for `fade`/`fadein`/`fadeout`: rebuild `color` at
 * `newAlpha`, carried at FULL precision. It used to round to Less's 8-decimal
 * `fround` here so that float drift emitted `0.7` and not `0.7000000000000001` —
 * but that is the OUTPUT policy's job (`formatNumber` trims exactly that noise),
 * and ruling V5 forbids quantizing a colour channel at construction precisely
 * because chained colour math compounds the error. A `#`-hex input keeps HEX
 * format ONLY when the literal already encoded an alpha channel (`#rgba` /
 * `#rrggbbaa`); an opaque hex (`#rgb` / `#rrggbb`) turns to `rgba(…)` the moment
 * it becomes translucent (Less 4.x/v5 parity — e.g. `fadeout(#ff0, 50%)` →
 * `rgba(255, 255, 0, 0.5)`, but `fade(#5F59, 10%)` → `#55ff551a`).
 *
 * The retag fires ONLY when the result is actually translucent (ledger **V10**, the
 * same `alpha < 1 ? RGB : <input format>` rule {@link mixColors} already applies).
 * It used to fire unconditionally, so a round trip back to opaque left the value
 * tagged `RGB` and `fade(#f00, 100%)` emitted `rgb(255, 0, 0)` where every other
 * computed opaque colour — `lighten` → `#b3f075`, `mix` → `#800080` — emits hex.
 * An opaque result has no alpha to carry, so there is nothing for the retag to say.
 */
export function withAlpha(color: Color, newAlpha: number): Color {
  const node = color.src;
  const hexDigits = typeof node === 'string' && node.startsWith('#') ? node.length - 1 : 0;
  const preserveHex = color.format === HEX && (hexDigits === 4 || hexDigits === 8);
  const format = newAlpha < 1 ? (preserveHex ? HEX : RGB) : color.format;
  return makeColorRgb(colorRawRgb(color), newAlpha, format, { modernSyntax: color.modernSyntax === true });
}

/**
 * Factory for the four HSL single-channel adjusters (`lighten`/`darken` on `l`,
 * `saturate`/`desaturate` on `s`). `channel` indexes `[h, s, l]`; `sign` adds or
 * subtracts the amount. A `relative` method scales the delta by the current
 * channel value. Preserves the input's alpha + output format.
 */
export function hslAdjust(channel: 1 | 2, sign: 1 | -1): (...args: Value[]) => Value {
  return (c, amt, m) => {
    const color = requireColor(c);
    const hsl = colorHsl(color);
    let adjust = requireDimension(amt).number / 100;
    if (m !== undefined && (m.type === 'Keyword' || m.type === 'Quoted') && textOf(m) === 'relative') {
      adjust = hsl[channel] * adjust;
    }
    const out: [number, number, number] = [hsl[0], hsl[1], hsl[2]];
    out[channel] += sign * adjust;
    return makeColorHsl(out, color.alpha, color.format);
  };
}

/**
 * Weighted blend of two colors (`mix`'s kernel; `tint`/`shade` are one-liners over
 * it). `weightPct` is the mix weight as a percentage (0-100). Byte-identical to
 * legacy `less/mix`: rounded-rgb operands, alpha-aware weight, format = RGB when
 * the result is translucent else the first operand's format.
 */
export function mixColors(c1: Color, c2: Color, weightPct: number): Color {
  const p = weightPct / 100.0;
  const w = p * 2 - 1;
  const a1 = clamp01(c1.alpha);
  const a2 = clamp01(c2.alpha);
  const a = a1 - a2;
  const w1 = ((w * a === -1 ? w : (w + a) / (1 + w * a)) + 1) / 2.0;
  const w2 = 1 - w1;
  const r1 = colorRgbRounded(c1);
  const r2 = colorRgbRounded(c2);
  const rgb: [number, number, number] = [
    r1[0] * w1 + r2[0] * w2,
    r1[1] * w1 + r2[1] * w2,
    r1[2] * w1 + r2[2] * w2
  ];
  const alpha = a1 * p + a2 * (1 - p);
  return makeColorRgb(rgb, alpha, alpha < 1 ? RGB : c1.format);
}

/**
 * Photoshop-style per-channel blend of two colors — the kernel the blend-mode fns
 * (`multiply`/`screen`/`overlay`/…) reduce to. `mode(cb, cs)` is the per-channel
 * blend over the 0-1 backdrop/source channels; the alpha compositing wrapper is the
 * W3C compositing-1 formula. Byte-faithful port of `@jesscss/fns`'s
 * `util/colorHelper#colorBlend`: rounded-rgb operands (legacy `Color.get rgb`),
 * raw (unrounded) result channels handed to the factory (the serializer rounds),
 * format = the first operand's format (preserved even when translucent).
 */
export function colorBlend(mode: (cb: number, cs: number) => number, c1: Color, c2: Color): Color {
  const ab = c1.alpha; // backdrop alpha
  const as = c2.alpha; // source alpha
  const r1 = colorRgbRounded(c1);
  const r2 = colorRgbRounded(c2);
  const ar = as + ab * (1 - as); // result alpha
  const rgb: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const cb = r1[i]! / 255; // backdrop channel
    const cs = r2[i]! / 255; // source channel
    let cr = mode(cb, cs);
    if (ar) {
      cr = (as * cs + ab * (cb - as * (cb + cs - cr))) / ar;
    }
    rgb[i] = cr * 255;
  }
  return makeColorRgb(rgb, ar, c1.format);
}

/** WCAG relative luminance (0-1) over the rounded rgb — legacy `util/get-luma`. */
export function getLuma(c: Color): number {
  const chan = (v: number): number => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = colorRgbRounded(c);
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/**
 * HSV triple `[h(deg), s(0-1), v(0-1)]` over the RAW (unrounded) rgb — legacy
 * `util/to-hsv` returns the raw-rgb result, so the hsv reader fns see unrounded
 * channels.
 */
export function toHsv(c: Color): [number, number, number] {
  const [R, G, B] = colorRawRgb(c);
  const r = R / 255, g = G / 255, b = B / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h: number;
  if (max === min) {
    h = 0;
  } else {
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
  return [h * 360, s, v];
}
