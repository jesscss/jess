import { Dimension, defineFunction } from '@jesscss/core';
import { mathHelper } from '../util/mathHelper';

export default defineFunction(
  'atan',
  function({ value }: { value: Dimension | number }) {
    return mathHelper(Math.atan, ['value'], 'rad', value);
  },
  {
    params: [{
      name: 'value',
      type: [Dimension, 'number']
    }]
  }
);
