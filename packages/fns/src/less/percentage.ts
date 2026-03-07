import { Dimension, defineFunction } from '@jesscss/core';
import { mathHelper } from '../util/mathHelper.js';

export default defineFunction(
  'percentage',
  function(value: Dimension | number) {
    return mathHelper(
      (val: number) => val * 100,
      ['value'],
      '%',
      value
    );
  },
  {
    params: [{
      name: 'value',
      type: [Dimension, 'number']
    }]
  }
);
