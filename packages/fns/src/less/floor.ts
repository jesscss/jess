import { Dimension, Num, defineFunction } from '@jesscss/core';
import { mathHelper } from '../util/mathHelper';

export default defineFunction(
  'floor',
  function(value: Dimension | number) {
    console.log('floor function received value:', value);
    console.log('value type:', typeof value);
    console.log('value constructor:', value?.constructor?.name);
    console.log('value instanceof Dimension:', value instanceof Dimension);
    console.log('value instanceof Num:', value instanceof Num);
    console.log('value value:', (value as any)?.value);
    return mathHelper(Math.floor, ['value'], undefined, value);
  },
  {
    params: [{
      name: 'value',
      type: [Dimension, 'number']
    }]
  }
);
