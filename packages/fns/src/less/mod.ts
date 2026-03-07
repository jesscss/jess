import { Dimension, defineFunction } from '@jesscss/core';

export default defineFunction(
  'mod',
  function(a: Dimension, b: Dimension) {
    return new Dimension({
      number: a.value.number % b.value.number,
      unit: a.value.unit
    });
  },
  {
    params: [{
      name: 'a',
      type: Dimension
    }, {
      name: 'b',
      type: Dimension
    }]
  }
);
