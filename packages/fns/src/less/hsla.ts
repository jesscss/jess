// hsla is an alias of hsl - it uses the same implementation but with a different name
import hsl from './hsl.js';
import { defineFunction, type FunctionThis, Call, TreeContext, Color, ColorFormat, Dimension, callWithContext } from '@jesscss/core';
import { splitSequence } from '@jesscss/core';

const hsla = defineFunction(
  'hsla',
  async function(this: FunctionThis, ...args: any[]) {
    // Get hsl's internal function to call it directly with the same args
    // This avoids double-wrapping through defineFunction which would try to convert again
    const hslInternal = (hsl as any)._internal;
    let result: Color;

    if (this?.context && hslInternal) {
      // Called through callWithContext - use FunctionThis to call hsl's internal function
      result = await hslInternal.call(this, ...args);
    } else if (hslInternal) {
      // Called directly - call hsl's internal function directly with converted args
      // Note: args are already converted (Dimensions -> numbers) by hsla's wrapper
      // hslInternal expects FunctionThis, but in direct calls we don't have it
      // Since context is undefined, args and rawArgs won't be used (hsl only uses them when context exists)
      result = await hslInternal.call({
        context: this?.context,
        args: async () => [],
        rawArgs: []
      } as any, ...args);
    } else {
      // Fallback: call hsl directly (shouldn't happen)
      result = await (hsl as any)(...args);
    }

    // Override the Call node name to 'hsla' if result has a node (from Dimension branch)
    // Color inputs return early from hsl, so they won't have a node
    if (result instanceof Color && result.value.node && this?.context) {
      let context = this.context;
      let treeContext = context.treeContext;
      context.treeContext = new TreeContext({
        mathMode: 'parens-division'
      });

      result.value.node = new Call({
        name: 'hsla',
        args: await this.rawArgs.eval(context)
      });
      context.treeContext = treeContext;
    }

    return result;
  },
  (hsl as any).options
);

export default hsla;