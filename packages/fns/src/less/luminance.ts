import { Color, defineFunction, Dimension } from '@jesscss/core';

export default defineFunction(
  'luminance',
  function(color: Color) {
    const luminance =
      (0.2126 * color.rgb[0] / 255)
      + (0.7152 * color.rgb[1] / 255)
      + (0.0722 * color.rgb[2] / 255);

    return new Dimension({
      number: luminance * color.alpha * 100,
      unit: '%'
    });
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);