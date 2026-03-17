import { Color } from '@jesscss/core';
import { createFromAdapter } from '../transform/adapter.js';

export const transformColorToLess = createFromAdapter<Color>({
  fields: {
    rgb: c => c.rgb || [0, 0, 0],
    alpha: c => c._alpha,
    value: (c) => {
      const rgb = c.rgb;
      const alpha = c._alpha;
      if (rgb && alpha !== undefined && alpha < 1) {
        return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
      }
      if (rgb) {
        const hex = rgb.map((v) => {
          const numericValue = Array.isArray(v) ? v[0] : v;
          return Math.round(numericValue).toString(16).padStart(2, '0');
        }).join('');
        return `#${hex}`;
      }
      return '';
    }
  }
});
