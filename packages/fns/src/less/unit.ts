import {
  Any,
  Dimension,
  Quoted,
  defineFunction
} from '@jesscss/core';

export default defineFunction(
  'unit',
  function(dimension: Dimension, unit?: Any<'keyword'> | Quoted) {
    const resolvedUnit = unit?.valueOf();
    return new Dimension(
      resolvedUnit
        ? {
            number: dimension.value.number,
            unit: resolvedUnit
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
      type: [Any, Quoted],
      optional: true
    }]
  }
);