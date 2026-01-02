import { Color, ColorFormat, Dimension, defineFunction, type FunctionThis, Call, TreeContext } from '@jesscss/core';
import { normalizeHue, percentOf, toNumber } from '@jesscss/core';

const hsl = defineFunction(
  'hsl',
  async function(this: FunctionThis, h: number, s: number, l: number) {
    // Create a color with HSL format and store the original function call
    const color = new Color({
      format: ColorFormat.HSL,
      hsl: [h, s, l],
      alpha: 1
    });

    // Store the original function call
    if (this.context) {
      let context = this.context;
      let treeContext = context.treeContext;
      /** Make sure we preserve a slash in the argument */
      context.treeContext = new TreeContext({
        mathMode: 'parens-division'
      });

      color.value.node = new Call({
        name: 'hsl',
        args: await this.rawArgs.eval(context)
      });
      context.treeContext = treeContext;
    }

    return color;
  },
  {
    params: [{
      name: 'h',
      type: Dimension,
      convert: [normalizeHue(), toNumber()]
    }, {
      name: 's',
      type: Dimension,
      convert: [percentOf(1), toNumber()]
    }, {
      name: 'l',
      type: Dimension,
      convert: [percentOf(1), toNumber()]
    }],
    splitSequence: true
  }
);

export default hsl;