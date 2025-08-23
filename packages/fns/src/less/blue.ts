import { defineFunction, Color, Num } from '@jesscss/core';

export default defineFunction(
  'blue',
  function(color: Color) {
    return new Num(color.rgb[2]);
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);