// rgba is an alias of rgb - it uses the same implementation but with a different name
import rgb from './rgb.js';
import { defineFunction, type FunctionThis } from '@jesscss/core';

const rgba = defineFunction(
  'rgba',
  async function(this: FunctionThis, ...args: any[]) {
    // Get rgb's internal function to call it directly with the same args
    // This avoids double-wrapping through defineFunction which would try to convert again
    const rgbInternal = (rgb as any)._internal;
    let result: unknown;

    if (this?.context && rgbInternal) {
      // Called through callWithContext - use FunctionThis to call rgb's internal function
      result = await rgbInternal.call(this, ...args);
    } else if (rgbInternal) {
      // Called directly - call rgb's internal function directly with converted args
      // Note: args are already converted (Dimensions -> numbers) by rgba's wrapper
      // rgbInternal expects FunctionThis, but in direct calls we don't have it
      // Since context is undefined, args and rawArgs won't be used (rgb only uses them when context exists)
      result = await rgbInternal.call({
        context: this?.context,
        args: async () => [],
        rawArgs: []
      } as any, ...args);
    } else {
      // Fallback: call rgb directly (shouldn't happen)
      result = await (rgb as any)(...args);
    }

    return result;
  },
  (rgb as any).options
);

export default rgba;