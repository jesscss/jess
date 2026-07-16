import type { Color, Dimension } from '../value-eval.js';
import { colorRawRgb, makeColorRgb } from '../value-factory.js';
import { HEX, RGB } from '../serialize-value.js';
import type { NativeFn } from './types.js';

/** `fade(color, amount)` — SET alpha to `amount`%. Byte-faithful to `less/fade`. */
export const fade: NativeFn = {
  name: 'fade',
  params: [{ kinds: ['color'] }, { kinds: ['dimension'] }],
  body: (c, amt) => {
    const color = c as Color;
    const newAlpha = (amt as Dimension).number / 100;
    const node = color.node;
    const preserveHex = color.format === HEX && typeof node === 'string' && node.startsWith('#');
    return makeColorRgb(colorRawRgb(color), newAlpha, preserveHex ? HEX : RGB, { modernSyntax: color.modernSyntax === true });
  },
};
