import { Dimension, defineFunction } from '@jesscss/core';
import { mathHelper } from '../util/mathHelper';

export default defineFunction(
  'asin',
  function({ value }: { value: Dimension | number }) {
    return mathHelper(Math.asin, ['value'], 'rad', value);
  },
  {
    params: [{
      name: 'value',
      type: [Dimension, 'number']
    }]
  }
);
