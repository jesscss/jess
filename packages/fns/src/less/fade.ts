import {
  type Context,
  Color,
  Dimension,
  defineFunction
} from '@jesscss/core';
import { getHsla } from '../util/get-hsla';
import { toHSL } from '../util/to-hsl';
import { clamp } from '../util/number';

const fade = defineFunction(
  'fade',
  function(this: Context, color: Color, amount: Dimension) {
    const hsl = toHSL(color);

    hsl.a = amount.value.number / 100;
    hsl.a = clamp(hsl.a);
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

export default fade;