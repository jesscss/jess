import type { Color } from '@jesscss/core/value';
import { colorRgbRounded, makeDimension } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `blue(color)` — the rounded blue channel (0-255). Byte-faithful to `less/blue`. */
export const blue: Fn = {
  name: 'blue',
  params: [{ kinds: ['Color'] }],
  body: (c) => makeDimension(colorRgbRounded(c as Color)[2], ''),
};
