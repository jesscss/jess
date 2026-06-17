// hsla is an alias of hsl - it uses the same implementation but with a different name
import { hslImplementation, hslOptions } from './hsl.js';
import { defineFunction, type FunctionThis } from '@jesscss/core';

const hsla = defineFunction(
  'hsla',
  async function(this: FunctionThis, ...args: any[]) {
    const result = await hslImplementation.call(this?.context ? this : undefined, ...args);

    return result;
  },
  hslOptions
);

export default hsla;
