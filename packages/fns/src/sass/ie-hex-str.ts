/**
 * Sass ie-hex-str() function
 * 
 * Creates a hex representation of a color in #AARRGGBB format.
 * This is the same as Less's argb() function, just with a different name.
 * 
 * @example
 * ie-hex-str(rgba(90, 23, 148, 0.5)) // #805a1794
 */
import { defineFunction, Color } from '@jesscss/core';
import argbLess from '../less/argb.js';

// Get the internal function and options from the Less implementation
const argbInternal = (argbLess as any)._internal;
const argbOptions = (argbLess as any).options;

// Create new function with Sass name but same implementation
const ieHexStr = defineFunction(
  'ie-hex-str',
  argbInternal,
  argbOptions
);

export default ieHexStr;
