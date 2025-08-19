import { Dimension, defineFunction } from '@jesscss/core';
import { mathHelper } from '../util/mathHelper';
import lodashRound from 'lodash-es/round';

export default defineFunction(
  'round',
  function({ value, precision = 0 }: { value: Dimension | number; precision?: Dimension | number }) {
    return mathHelper(lodashRound, ['value', 'precision'], undefined, value, precision);
  },
  {
    params: [{
      name: 'value',
      type: [Dimension, 'number']
    }, {
      name: 'precision',
      type: [Dimension, 'number'],
      optional: true,
      default: 0
    }]
  }
);
