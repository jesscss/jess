import {
  Color,
  type Context,
  Dimension,
  defineFunction
} from '@jesscss/core';
import desaturate from './desaturate.js';

const greyscale = defineFunction(
  'greyscale',
  function(this: Context, color: Color) {
    return desaturate.call(this, color, new Dimension({ number: 100, unit: '%' }));
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);

export default greyscale;