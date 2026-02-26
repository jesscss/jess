import {
  Color,
  Dimension,
  defineFunction
} from '@jesscss/core';
import { toHSL } from '../util/to-hsl.js';

//
// Copyright (c) 2006-2009 Hampton Catlin, Natalie Weizenbaum, and Chris Eppstein
// http://sass-lang.com
//
const mix = defineFunction(
  'mix',
  function(color1: Color, color2: Color, weight?: Dimension) {
    if (!weight) {
      weight = new Dimension({ number: 50, unit: '%' });
    }
    const p = weight.value.number / 100.0;
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
    out.options.format = color1.options.format;
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