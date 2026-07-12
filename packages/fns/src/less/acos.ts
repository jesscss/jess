import { Dimension, defineFunction } from '@jesscss/core';
import { mathHelper } from '../util/mathHelper.js';

export default defineFunction(
  'acos',
  function(value: Dimension | number) {
    return mathHelper(Math.acos, ['value'], 'rad', value);
  },
  {
    params: [{
      name: 'value',
      type: [Dimension, 'number']
    }]
  }
);
