import {
  Color,
  ColorFormat,
  Dimension,
  defineFunction
} from '@jesscss/core';
import { toHSL } from '../util/to-hsl.js';

//
// Copyright (c) 2006-2009 Hampton Catlin, Natalie Weizenbaum, and Chris Eppstein
// http://sass-lang.com
//
/**
 * Less `mix()` — blend two colors by `weight` (default `50%`), following the
 * Sass/less.js weighting that also accounts for the colors' alpha channels.
 * @param color1 the first `Color` (weighted by `weight`)
 * @param color2 the second `Color`
 * @param weight optional mix weight as a `Dimension` percentage (default `50%`)
 * @returns the mixed `Color`
 */
const mix = defineFunction(
  'mix',
  function(color1: Color, color2: Color, weight?: Dimension) {
    if (!weight) {
      weight = new Dimension({ number: 50, unit: '%' });
    }
    const p = weight.number / 100.0;
    const w = p * 2 - 1;
    const a = toHSL(color1).a - toHSL(color2).a;

    const w1 = (((w * a === -1) ? w : (w + a) / (1 + w * a)) + 1) / 2.0;
    const w2 = 1 - w1;

    const rgba = [
      color1.rgb[0] * w1 + color2.rgb[0] * w2,
      color1.rgb[1] * w1 + color2.rgb[1] * w2,
      color1.rgb[2] * w1 + color2.rgb[2] * w2,
      color1.alpha * p + color2.alpha * (1 - p)
    ];

    const out = new Color(rgba);
    out.options.format = rgba[3]! < 1 ? ColorFormat.RGB : color1.options.format;
    return out;
  },
  {
    params: [{
      name: 'color1',
      type: Color
    }, {
      name: 'color2',
      type: Color
    }, {
      name: 'weight',
      type: Dimension,
      optional: true
    }]
  }
);

export default mix;
