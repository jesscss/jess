/**
 * Sass fade-in() function
 * 
 * Decrease the transparency (or increase the opacity) of a color, making it more opaque.
 * This is the same as Less's fadein() function, just with different naming.
 * 
 * @example
 * fade-in(hsla(90, 90%, 50%, 0.5), 10%) // rgba(128, 242, 13, 0.6)
 */
import { defineFunction } from '@jesscss/core';
import fadeinLess from '../less/fadein.js';

// Get the internal function and options from the Less implementation
const fadeinInternal = (fadeinLess as any)._internal;
const fadeinOptions = (fadeinLess as any).options;

// Create new function with Sass name but same implementation
const fadeIn = defineFunction(
  'fade-in',
  fadeinInternal,
  fadeinOptions
);

export default fadeIn;
