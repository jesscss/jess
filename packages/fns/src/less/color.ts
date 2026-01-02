import {
  defineFunction,
  Node,
  Color,
  ColorFormat,
  Quoted
} from '@jesscss/core';
import colors from 'color-name';

const colorRegex = /^#([A-Fa-f0-9]{8}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{3,4})$/i;

export default defineFunction(
  'color',
  function(c: Node) {
    if (c instanceof Color) {
      return c;
    }
    let value = c instanceof Quoted ? c.valueOf() : c.value as string;
    if (typeof value !== 'string') {
      throw new Error('argument must be a color keyword or 3|4|6|8 digit hex e.g. #FFF');
    }
    let colorValue = colors[value];
    if (colorValue) {
      return new Color({
        node: value,
        format: ColorFormat.HEX,
        rgb: colorValue,
        alpha: 1
      });
    }
    if (colorRegex.test(value)) {
      return new Color(value);
    }
  },
  {
    params: [{
      name: 'c',
      type: Node
    }]
  }
);
