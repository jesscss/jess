import { defineFunction, Color, Dimension } from '@jesscss/core';

export default defineFunction(
  'green',
  function(color: Color) {
    return new Dimension({ number: color.rgb[1], unit: '' });
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);