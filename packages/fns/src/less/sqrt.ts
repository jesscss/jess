import { Dimension, defineFunction } from '@jesscss/core';
import { mathHelper } from '../util/mathHelper.js';

export default defineFunction(
  'sqrt',
  function(value: Dimension | number) {
    return mathHelper(Math.sqrt, ['value'], undefined, value);
  },
  {
    params: [{
      name: 'value',
      type: [Dimension, 'number']
    }]
  }
);
