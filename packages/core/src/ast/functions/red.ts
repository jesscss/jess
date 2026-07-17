import type { Color } from '../value-eval.js';
import { colorRgbRounded, makeDimension } from '../value-factory.js';
import type { Fn } from './types.js';

/** `red(color)` — the rounded red channel (0-255). Byte-faithful to `less/red`. */
export const red: Fn = {
  name: 'red',
  params: [{ kinds: ['Color'] }],
  body: (c) => makeDimension(colorRgbRounded(c as Color)[0], ''),
};
