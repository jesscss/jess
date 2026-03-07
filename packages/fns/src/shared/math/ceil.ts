import { Dimension, defineFunction } from '@jesscss/core';
import { mathHelper } from '../../util/mathHelper.js';

export default defineFunction(
  'ceil',
  function(value: Dimension | number) {
    return mathHelper(Math.ceil, ['value'], undefined, value);
  },
  {
    params: [{
      name: 'value',
      type: [Dimension, 'number']
    }]
  }
);
