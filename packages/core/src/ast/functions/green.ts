import type { Color } from '../value-eval.js';
import { colorRgbRounded, makeDimension } from '../value-factory.js';
import type { Fn } from './types.js';

/** `green(color)` — the rounded green channel (0-255). Byte-faithful to `less/green`. */
export const green: Fn = {
  name: 'green',
  params: [{ kinds: ['Color'] }],
  body: (c) => makeDimension(colorRgbRounded(c as Color)[1], ''),
};
