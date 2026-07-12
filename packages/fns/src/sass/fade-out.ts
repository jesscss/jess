/**
 * Sass fade-out() function
 * 
 * Increase the transparency (or decrease the opacity) of a color, making it less opaque.
 * This is the same as Less's fadeout() function, just with different naming.
 * 
 * @example
 * fade-out(hsla(90, 90%, 50%, 0.5), 10%) // rgba(128, 242, 13, 0.4)
 */
import { defineFunction } from '@jesscss/core';
import fadeoutLess from '../less/fadeout.js';

// Get the internal function and options from the Less implementation
const fadeoutInternal = (fadeoutLess as any)._internal;
const fadeoutOptions = (fadeoutLess as any).options;

// Create new function with Sass name but same implementation
const fadeOut = defineFunction(
  'fade-out',
  fadeoutInternal,
  fadeoutOptions
);

export default fadeOut;
