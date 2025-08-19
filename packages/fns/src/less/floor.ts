import { Dimension, defineFunction } from '@jesscss/core';
import { mathHelper } from '../util/mathHelper';

export default defineFunction(
  'floor',
  function({ value }: { value: Dimension | number }) {
    return mathHelper(Math.floor, ['value'], undefined, value);
  },
  {
    params: [{
      name: 'value',
      type: [Dimension, 'number']
    }]
  }
);
