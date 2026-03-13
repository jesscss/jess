/**
 * Sass opacity() function
 *
 * Extracts the alpha channel from a color, or passes through CSS filter function
 * if given a number (for CSS filter: opacity()).
 *
 * @example
 * opacity(rgba(255, 0, 0, 0.5)) // 0.5
 * opacity(50%) // CSS filter passthrough (returns as-is for now)
 */
import { defineFunction, Color, Dimension } from '@jesscss/core';

const opacity = defineFunction(
  'opacity',
  function(colorOrNumber: Color | Dimension): Dimension {
    // If it's a Dimension (number), pass through as CSS filter function
    // In Sass, this would return a SassString with the function call
    // For now, we'll just return the dimension as-is
    if (colorOrNumber instanceof Dimension) {
      // TODO: Return a Call node with 'opacity' name for CSS filter passthrough
      // For now, return the dimension
      return colorOrNumber;
    }

    // Extract alpha from color
    const color = colorOrNumber as Color;
    return new Dimension({ number: color.alpha, unit: undefined });
  },
  {
    params: [
      {
        name: 'color',
        type: [Color, Dimension]
      }
    ]
  }
);

export default opacity;
