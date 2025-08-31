import { getNumber, type ColorValue } from '../util/number';
import { defineFunction, Dimension, Operation, Sequence, Node } from '@jesscss/core';
import hsla from './hsla';
import { getColorFunctionValues } from '../util/get-color-func-values';

const hsl = defineFunction(
  'hsl',
  function(this: any, h: ColorValue | Sequence, s: ColorValue, l: ColorValue) {
    const values = getColorFunctionValues(h as Sequence | Dimension, s as Dimension, l as Dimension);
    return hsla.call(this, values[0], values[1], values[2], values[3]);
  },
  {
    params: [{
      name: 'h',
      type: [Sequence, Dimension, 'number']
    }, {
      name: 's',
      type: [Dimension, 'number']
    }, {
      name: 'l',
      type: [Dimension, 'number']
    }]
  }
);

export default hsl;