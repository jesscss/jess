/**
 * Sass transparentize() function
 * 
 * Decrease the opacity of a color by an absolute amount.
 * This is the same as Less's fadeout() function, just with different naming.
 * Note: fade-out() is an alias for transparentize() in Sass.
 * 
 * @example
 * transparentize(hsla(90, 90%, 50%, 0.5), 0.1) // rgba(128, 242, 13, 0.4)
 */
import { defineFunction } from '@jesscss/core';
import fadeoutLess from '../less/fadeout.js';

// Get the internal function and options from the Less implementation
const fadeoutInternal = (fadeoutLess as any)._internal;
const fadeoutOptions = (fadeoutLess as any).options;

// Create new function with Sass name but same implementation
const transparentize = defineFunction(
  'transparentize',
  fadeoutInternal,
  fadeoutOptions
);

export default transparentize;
