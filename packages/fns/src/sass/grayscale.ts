/**
 * Sass grayscale() function
 * 
 * Remove all saturation from a color in the HSL color space.
 * This is the same as Less's greyscale() function, just with different spelling.
 * 
 * @example
 * grayscale(hsl(90, 90%, 50%)) // #808080
 */
import { defineFunction } from '@jesscss/core';
import greyscaleLess from '../less/greyscale.js';

// Get the internal function and options from the Less implementation
const greyscaleInternal = (greyscaleLess as any)._internal;
const greyscaleOptions = (greyscaleLess as any).options;

// Create new function with Sass name but same implementation
const grayscale = defineFunction(
  'grayscale',
  greyscaleInternal,
  greyscaleOptions
);

export default grayscale;
