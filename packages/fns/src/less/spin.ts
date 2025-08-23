import {
  type Context,
  Color,
  Dimension,
  defineFunction
} from '@jesscss/core';
import { getHsla } from '../util/get-hsla';
import { toHSL } from '../util/to-hsl';

export default defineFunction(
  'spin',
  function(this: Context, color: Color, amount: Dimension) {
    const hsl = toHSL(color);
    const hue = (hsl.h + amount.value.number) % 360;

    hsl.h = hue < 0 ? 360 + hue : hue;

    return getHsla.call(this, color, hsl);
  },
  {
    params: [{
      name: 'color',
      type: Color
    }, {
      name: 'amount',
      type: Dimension
    }]
  }
);