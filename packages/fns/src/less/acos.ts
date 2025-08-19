import { Dimension, defineFunction } from '@jesscss/core';
import { mathHelper } from '../util/mathHelper';

export default defineFunction(
  'acos',
  function({ value }: { value: Dimension | number }) {
    return mathHelper(Math.acos, ['value'], 'rad', value);
  },
  {
    params: [{
      name: 'value',
      type: [Dimension, 'number']
    }]
  }
);
