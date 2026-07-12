import { Dimension, defineFunction } from '@jesscss/core';

export default defineFunction(
  'mod',
  function(a: Dimension, b: Dimension) {
    return new Dimension({
      number: a.data.number % b.data.number,
      unit: a.data.unit
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
