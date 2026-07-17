import type { Color } from '@jesscss/core/value';
import { colorRgbRounded, makeDimension } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `red(color)` — the rounded red channel (0-255). Byte-faithful to `less/red`. */
export const red: Fn = {
  name: 'red',
  params: [{ kinds: ['Color'] }],
  body: (c) => makeDimension(colorRgbRounded(c as Color)[0], ''),
};
