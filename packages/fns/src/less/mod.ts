import { Dimension, defineFunction } from '@jesscss/core';

export default defineFunction(
  'mod',
  function(a: Dimension, b: Dimension) {
    return new Dimension({
      number: a.number % b.number,
      unit: a.unit
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
