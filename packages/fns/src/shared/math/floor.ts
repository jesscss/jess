import { Dimension, Num, defineFunction } from '@jesscss/core';
import { mathHelper } from '../../util/mathHelper.js';

export default defineFunction(
  'floor',
  function(value: Dimension | number) {
    return mathHelper(Math.floor, ['value'], undefined, value);
  },
  {
    params: [{
      name: 'value',
      type: [Dimension, 'number']
    }]
  }
);
