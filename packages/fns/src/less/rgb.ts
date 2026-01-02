import {
  type FunctionThis,
  Dimension,
  Color,
  ColorFormat,
  defineFunction,
  Call,
  TreeContext
} from '@jesscss/core';
import { percentOf, toNumber } from '@jesscss/core';

const rgb = defineFunction(
  'rgb',
  async function(this: FunctionThis, r: number, g: number, b: number) {
    // Create a color with RGB format and store the original function call
    const color = new Color({
      format: ColorFormat.RGB,
      rgb: [r, g, b],
      alpha: 1
    });

    // Store the original function call
    if (this.context) {
      let context = this.context;
      let treeContext = context.treeContext;
      context.treeContext = new TreeContext({
        mathMode: 'parens-division'
      });

      color.value.node = new Call({
        name: 'rgb',
        args: await this.rawArgs.eval(context)
      });
      context.treeContext = treeContext;
    }

    return color;
  },
  {
    params: [
      {
        name: 'r',
        type: Dimension,
        convert: [percentOf(255), toNumber()]
      },
      {
        name: 'g',
        type: Dimension,
        convert: [percentOf(255), toNumber()]
      },
      {
        name: 'b',
        type: Dimension,
        convert: [percentOf(255), toNumber()]
      }
    ],
    splitSequence: true
  }
);

export default rgb;