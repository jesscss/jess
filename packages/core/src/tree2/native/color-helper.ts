/**
 * Shared color kernels the native color fns reduce to — the color-domain twin of
 * `math-helper.ts`. Pure functions over the tree2 value `Color`: the Sass-derived
 * `mixColors` weight blend, WCAG `getLuma`, and `toHsv`. Byte-faithful ports of
 * `@jesscss/fns`'s `mix` / `util/get-luma` / `util/to-hsv`.
 *
 * HARD MODULE BOUNDARY: value domain only (no `../tree`, no legacy node).
 */
import type { Color } from '../value-eval.js';
import { RGB } from '../serialize-value.js';
import { colorRawRgb, colorRgbRounded, makeColorRgb } from '../value-factory.js';

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);

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
    r1[2] * w1 + r2[2] * w2,
  ];
  const alpha = a1 * p + a2 * (1 - p);
  return makeColorRgb(rgb, alpha, alpha < 1 ? RGB : c1.format);
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
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s, v];
}
