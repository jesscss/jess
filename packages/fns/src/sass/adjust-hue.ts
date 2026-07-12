/**
 * Sass adjust-hue() function
 *
 * Adjusts the hue angle of a color.
 * This is functionally the same as Less's spin() function, which also adjusts hue.
 *
 * @example
 * adjust-hue(hsl(10, 90%, 50%), 30deg) // hsl(40, 90%, 50%)
 */
import { defineFunction } from '@jesscss/core';
import spinLess from '../less/spin.js';

// Get the internal function and options from the Less implementation
const spinInternal = (spinLess as any)._internal;
const spinOptions = (spinLess as any).options;

// Create new function with Sass name but same implementation
const adjustHue = defineFunction(
  'adjust-hue',
  spinInternal,
  spinOptions
);

export default adjustHue;
