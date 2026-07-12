/**
 * Sass opacify() function
 * 
 * Increase the opacity of a color by an absolute amount.
 * This is the same as Less's fadein() function, just with different naming.
 * Note: fade-in() is an alias for opacify() in Sass.
 * 
 * @example
 * opacify(hsla(90, 90%, 50%, 0.5), 0.1) // rgba(128, 242, 13, 0.6)
 */
import { defineFunction } from '@jesscss/core';
import fadeinLess from '../less/fadein.js';

// Get the internal function and options from the Less implementation
const fadeinInternal = (fadeinLess as any)._internal;
const fadeinOptions = (fadeinLess as any).options;

// Create new function with Sass name but same implementation
const opacify = defineFunction(
  'opacify',
  fadeinInternal,
  fadeinOptions
);

export default opacify;
