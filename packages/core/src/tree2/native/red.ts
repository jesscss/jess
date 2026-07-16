import type { Color } from '../value-eval.js';
import { colorRgbRounded, makeDimension } from '../value-factory.js';
import type { NativeFn } from './types.js';

/** `red(color)` — the rounded red channel (0-255). Byte-faithful to `less/red`. */
export const red: NativeFn = {
  name: 'red',
  params: [{ kinds: ['color'] }],
  body: (c) => makeDimension(colorRgbRounded(c as Color)[0], ''),
};
