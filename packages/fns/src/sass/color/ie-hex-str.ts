import type { Fn } from '@jesscss/core/value';
import { HEX, colorRawRgb, defineFunction, makeColorRgb } from '@jesscss/core/value';
import { ieHexString, noExcess, requireColor } from './kernels.js';

/**
 * `color.ie-hex-str(color)` — the `#AARRGGBB` string (alpha FIRST) in UPPER case.
 *
 * NOT an alias of Less's `argb`: the case differs, so re-exporting the Less body
 * under this name would emit the wrong bytes. dart-sass:
 * `ie-hex-str(rgba(255,0,0,0.5))` → `#80FF0000` (Less's `argb` → `#80ff0000`);
 * `ie-hex-str(#f00)` → `#FFFF0000`; `ie-hex-str(rgba(90,23,148,0.5))` →
 * `#805A1794`; `ie-hex-str(hsl(120,50%,50%))` → `#FF40BF40`;
 * `ie-hex-str(rgba(1.6,2,3,0.333))` → `#55020203` (channels and alpha quantize at
 * this output boundary — that IS the boundary).
 */
export const ieHexStr: Fn = defineFunction('ie-hex-str', {
  params: [{ name: 'color', kinds: ['Color'] }, { name: 'excess', kinds: 'any', optional: true }],
  body: (c, excess) => {
    noExcess(excess, 1);
    const color = requireColor(c);
    return makeColorRgb(colorRawRgb(color), color.alpha, HEX, { node: ieHexString(color) });
  }
});

export default ieHexStr;
