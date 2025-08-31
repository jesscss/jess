import {
  type FunctionThis,
  Dimension,
  Color,
  ColorFormat,
  defineFunction,
  Call
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
    if (this?.args) {
      color.value.node = new Call({
        name: 'rgb',
        args: await this.args()
      });
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