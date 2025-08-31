import { Color, ColorFormat, Dimension, defineFunction, type FunctionThis, Call } from '@jesscss/core';
import { normalizeHue, percentOf, alphaToNumber } from '@jesscss/core';

const hsla = defineFunction(
  'hsla',
  async function(this: FunctionThis, h: number, s: number, l: number, a: number) {
    // Create a color with HSL format and store the original function call
    const color = new Color({
      format: ColorFormat.HSL,
      hsl: [h, s, l],
      alpha: a
    });

    // Store the original function call
    if (this?.args) {
      color.value.node = new Call({
        name: 'hsla',
        args: await this.args()
      });
    }

    return color;
  },
  {
    params: [{
      name: 'h',
      type: Dimension,
      convert: [normalizeHue()]
    }, {
      name: 's',
      type: Dimension,
      convert: [percentOf(1)]
    }, {
      name: 'l',
      type: Dimension,
      convert: [percentOf(1)]
    }, {
      name: 'a',
      type: Dimension,
      convert: [alphaToNumber()]
    }],
    splitSequence: true
  }
);

export default hsla;