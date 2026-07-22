// rgba is an alias of rgb - it uses the same implementation but with a different name
import { rgbImplementation, rgbOptions } from './rgb.js';
import { defineFunction, type FunctionThis } from '@jesscss/core';

/**
 * Less `rgba()` — alias of `rgb()` kept for CSS `rgba()` compatibility; shares the
 * same implementation ({@link rgbImplementation}) and overloads.
 */
const rgba = defineFunction(
  'rgba',
  async function(this: FunctionThis, ...args: any[]) {
    const result = await rgbImplementation.call(this?.context ? this : undefined, ...args);

    return result;
  },
  rgbOptions
);

export default rgba;
