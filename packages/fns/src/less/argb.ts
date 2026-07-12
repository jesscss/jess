import { defineFunction, Color, Num } from '@jesscss/core';

export default defineFunction(
  'argb',
  function(color: Color) {
    let newColor = color.clone();
    const values = color.rgb;
    values.unshift(Math.round(color.alpha * 255));
    newColor.setData('node', '#' + values.map(function(c) {
      let hex = c.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join(''));
    return newColor;
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);