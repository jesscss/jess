import type { Fn } from '@jesscss/core/value';
import { colorRawRgb, colorRgbRounded, makeColorRgb, defineFunction, HEX } from '@jesscss/core/value';
import { requireColor } from './color-helper.js';

const hex2 = (v: number): string => {
  const h = v.toString(16);
  return h.length === 1 ? `0${h}` : h;
};

/**
 * `argb(color)` — the `#AARRGGBB` string (alpha FIRST), byte-faithful to `less/argb`:
 * `Math.round(alpha * 255)` then the rounded rgb channels. Carried as a verbatim
 * `node` so the color emits that exact hex.
 */
export const argb: Fn = defineFunction('argb', {
  params: [{ kinds: ['Color'] }],
  body: (c) => {
    const color = requireColor(c);
    const [r, g, b] = colorRgbRounded(color);
    const a = Math.round(color.alpha * 255);
    const node = `#${hex2(a)}${hex2(r)}${hex2(g)}${hex2(b)}`;
    return makeColorRgb(colorRawRgb(color), color.alpha, HEX, { src: node });
  }
});
