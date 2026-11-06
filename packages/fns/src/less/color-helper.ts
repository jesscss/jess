/**
 * Shared color kernels the color fns reduce to — the color-domain twin of
 * `math-helper.ts`. Pure functions over the tree2 value `Color`: the Sass-derived
 * WCAG `getLuma`, and `toHsv`. Byte-faithful ports of
 * `@jesscss/fns`'s `util/get-luma` / `util/to-hsv`.
 *
 * HARD MODULE BOUNDARY: value domain only (no `../tree`, no legacy node).
 */
import { RGB, colorRawRgb, colorRgbRounded, makeColorRgb, serializeColor, withFields, type Color, type Value } from '@jesscss/core/value';
import { requireDimension } from '../shared/math/math-helper.js';

export function requireColor(value: Value): Color {
  if (value.type !== 'Color') {
    throw new TypeError('Expected a color value.');
  }
  return value;
}

/**
 * Rebuild `c` re-tagged to `format`, recomputing its serialized bytes (mirrors
 * `makeColorRgb`'s self-serialize). The reformat-to-input-format dance the
 * format-preserving fns share.
 */
export function reformatColor(c: Color, format: number): Color {
  const base = withFields(c, { format, bytes: '' });
  return withFields(base, { bytes: serializeColor(base) });
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
