import { Dimension, defineFunction } from '@jesscss/core';
import { mathHelper } from '../util/mathHelper.js';

/**
 * Less `percentage()` — convert a number to a percentage by multiplying by 100 and
 * applying the `%` unit (e.g. `0.5` → `50%`).
 * @param value unitless number or `Dimension`
 * @returns the value as a `%` `Dimension`
 */
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
