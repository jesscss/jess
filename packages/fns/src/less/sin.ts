import { Dimension, defineFunction } from '@jesscss/core';
import { mathHelper } from '../util/mathHelper.js';

export default defineFunction(
  'sin',
  function(value: Dimension | number) {
    return mathHelper(Math.sin, ['value'], '', value);
  },
  {
    params: [{
      name: 'value',
      type: [Dimension, 'number']
    }]
  }
);
