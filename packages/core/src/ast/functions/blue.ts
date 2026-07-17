import type { Color } from '../value-eval.js';
import { colorRgbRounded, makeDimension } from '../value-factory.js';
import type { Fn } from './types.js';

/** `blue(color)` — the rounded blue channel (0-255). Byte-faithful to `less/blue`. */
export const blue: Fn = {
  name: 'blue',
  params: [{ kinds: ['Color'] }],
  body: (c) => makeDimension(colorRgbRounded(c as Color)[2], ''),
};
