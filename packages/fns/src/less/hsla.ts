import { Color, ColorFormat, Dimension, defineFunction } from '@jesscss/core';
import { type ColorValue, clamp, getNumber } from '../util/number';

const hsla = defineFunction(
  'hsla',
  function(this: any, h: ColorValue, s: ColorValue, l: ColorValue, a: ColorValue) {
    h = getNumber(h) % 360;
    s = clamp(getNumber(s));
    l = clamp(getNumber(l));
    a = clamp(getNumber(a));

    const color = new Color(ColorFormat.HSL);
    color.hsla = [h, s, l, a];
    return color;
  },
  {
    params: [{
      name: 'h',
      type: [Dimension, 'number']
    }, {
      name: 's',
      type: [Dimension, 'number']
    }, {
      name: 'l',
      type: [Dimension, 'number']
    }, {
      name: 'a',
      type: [Dimension, 'number']
    }]
  }
);

export default hsla;