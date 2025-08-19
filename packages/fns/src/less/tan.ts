import { Dimension, defineFunction } from '@jesscss/core';
import { mathHelper } from '../util/mathHelper';

export default defineFunction(
  'tan',
  function({ value }: { value: Dimension | number }) {
    return mathHelper(Math.tan, ['value'], '', value);
  },
  {
    params: [{
      name: 'value',
      type: [Dimension, 'number']
    }]
  }
);
