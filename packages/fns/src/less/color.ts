import {
  defineFunction,
  Node,
  Color,
  ColorFormat,
  Quoted
} from '@jesscss/core';
import colors from 'color-name';

const colorRegex = /^#([A-Fa-f0-9]{8}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{3,4})$/i;

/**
 * Less `color()` — parse a string into a `Color`. Accepts a named CSS color or a
 * 3/4/6/8-digit hex string; a `Color` argument passes through (named colors are
 * re-tagged as hex).
 * @param c a `Quoted` string (color name or hex) or an existing `Color`
 * @returns the parsed `Color`
 * @throws if the string is neither a known color keyword nor a valid hex value
 */
export default defineFunction(
  'color',
  function(c: Color | Quoted) {
    if (c instanceof Color) {
      const sourceNode = c.node;
      const namedColor = typeof sourceNode === 'string' ? colors[sourceNode.toLowerCase()] : undefined;
      if (namedColor) {
        return new Color({
          format: ColorFormat.HEX,
          rgb: c.rgb,
          alpha: c.alpha
        });
      }
      return c;
    }
    // Quoted/Any values both normalize through valueOf()
    const value = c.valueOf();
    // Check if it's a color keyword
    const colorValue = colors[value];
    if (colorValue) {
      return new Color({
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
