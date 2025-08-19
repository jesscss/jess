import { Dimension, defineFunction } from '@jesscss/core';
import { mathHelper } from '../util/mathHelper';

export default defineFunction(
  'sqrt',
  function({ value }: { value: Dimension | number }) {
    return mathHelper(Math.sqrt, ['value'], undefined, value);
  },
  {
    params: [{
      name: 'value',
      type: [Dimension, 'number']
    }]
  }
);
