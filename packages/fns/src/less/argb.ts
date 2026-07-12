import { defineFunction, Color } from '@jesscss/core';

export default defineFunction(
  'argb',
  function(color: Color) {
    const values = color.rgb;
    values.unshift(Math.round(color.alpha * 255));
    const node = '#' + values.map(function(c) {
      let hex = c.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
    return new Color({
      node,
      rgb: color._rgb,
      alpha: color.alpha
    });
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);
