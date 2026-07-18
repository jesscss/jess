import {
  Color,
  type Context,
  defineFunction
} from '@jesscss/core';

/**
 * Less `greyscale()` — remove all saturation from a color (HSL saturation set to 0).
 * @param color the input `Color`
 * @returns the desaturated (grey) `Color`
 */
const greyscale = defineFunction(
  'greyscale',
  function(this: Context, color: Color) {
    const [h, , l] = color._hsl;
    const result = new Color({
      hsl: [h, 0, l],
      alpha: color._alpha
    }, {
      format: color.options.format
    }).inherit(color);
    return result;
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);

export default greyscale;