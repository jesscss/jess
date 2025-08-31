import { Color, ColorFormat, Dimension, defineFunction } from '@jesscss/core';
import { type ColorValue, clamp, getNumber } from '../util/number';

const hsla = defineFunction(
  'hsla',
  function(this: any, h: ColorValue, s: ColorValue, l: ColorValue, a: ColorValue) {
    h = getNumber(h, true) % 360;
    s = clamp(getNumber(s, true));
    l = clamp(getNumber(l, true));
    a = clamp(getNumber(a));

    // Convert HSL to RGB for storage
    const color = new Color({
      format: ColorFormat.HSL,
      rgba: [0, 0, 0, a] // Placeholder, will be set by hsla setter
    });
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