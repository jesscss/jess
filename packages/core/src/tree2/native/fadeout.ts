import type { Color, Dimension, Keyword, Quoted } from '../value-eval.js';
import { colorRawRgb, textOf, makeColorRgb } from '../value-factory.js';
import { HEX, RGB } from '../serialize-value.js';
import type { NativeFn } from './types.js';

/** `fadeout(color, amount, method?)` — decrease alpha. Byte-faithful to `less/fadeout`. */
export const fadeout: NativeFn = {
  name: 'fadeout',
  params: [{ kinds: ['color'] }, { kinds: ['dimension'] }, { kinds: ['keyword', 'quoted'], optional: true }],
  body: (c, amt, m) => {
    const color = c as Color;
    let adjust = (amt as Dimension).number / 100;
    if (m !== undefined && textOf(m as Keyword | Quoted) === 'relative') adjust = color.alpha * adjust;
    const newAlpha = color.alpha - adjust;
    const node = color.node;
    const preserveHex = color.format === HEX && typeof node === 'string' && node.startsWith('#');
    return makeColorRgb(colorRawRgb(color), newAlpha, preserveHex ? HEX : RGB, { modernSyntax: color.modernSyntax === true });
  },
};
