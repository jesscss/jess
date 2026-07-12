import { Dimension, defineFunction } from '@jesscss/core';
import { mathHelper } from '../../util/mathHelper.js';
import lodashRound from 'lodash-es/round.js';

export default defineFunction(
  'round',
  function(value: Dimension | number, precision: Dimension | number = 0) {
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
