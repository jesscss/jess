import { defineFunction, Color, Num } from '@jesscss/core';

export default defineFunction(
  'red',
  function(color: Color) {
    return new Num(color.rgb[0]);
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);
