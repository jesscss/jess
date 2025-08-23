import {
  Any,
  Dimension,
  defineFunction
} from '@jesscss/core';

export default defineFunction(
  'unit',
  function(dimension: Dimension, unit?: Any<'keyword'>) {
    return new Dimension(
      unit
        ? {
            number: dimension.value.number,
            unit: unit.value
          }
        : { number: dimension.value.number }
    );
  },
  {
    params: [{
      name: 'dimension',
      type: Dimension
    }, {
      name: 'unit',
      type: Any,
      optional: true
    }]
  }
);