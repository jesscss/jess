import { Dimension, defineFunction } from '@jesscss/core';
import { mathHelper } from '../util/mathHelper.js';

export default defineFunction(
  'cos',
  function(value: Dimension | number) {
    return mathHelper(Math.cos, ['value'], '', value);
  },
  {
    params: [{
      name: 'value',
      type: [Dimension, 'number']
    }]
  }
);
