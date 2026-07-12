import { defineFunction, Color, Num } from '@jesscss/core';

export default defineFunction(
  'alpha',
  function(color: Color) {
    return new Num(color.alpha);
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);
