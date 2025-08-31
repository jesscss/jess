import { Color, ColorFormat, Dimension, defineFunction, type FunctionThis, Call } from '@jesscss/core';
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
    if (this?.args) {
      color.value.node = new Call({
        name: 'hsl',
        args: await this.args()
      });
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