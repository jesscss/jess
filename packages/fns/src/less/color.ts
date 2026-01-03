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
  function(c: Color | Quoted) {
    if (c instanceof Color) {
      return c;
    }
    // c is Quoted - get the string value
    const value = c.valueOf();
    // Check if it's a color keyword
    const colorValue = colors[value];
    if (colorValue) {
      return new Color({
        node: value,
        format: ColorFormat.HEX,
        rgb: colorValue,
        alpha: 1
      });
    }
    // Check if it's a valid hex string
    if (colorRegex.test(value)) {
      return new Color(value);
    }
    // If we get here, the value is neither a color keyword nor a valid hex string
    // This should have been caught by validation, but throw for safety
    throw new Error('argument must be a color keyword or 3|4|6|8 digit hex e.g. #FFF');
  },
  {
    params: [{
      name: 'c',
      type: [Color, Quoted]
    }]
  }
);
