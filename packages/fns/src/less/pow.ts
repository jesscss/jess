import { Dimension, defineFunction } from '@jesscss/core';

export default defineFunction(
  'pow',
  function(x: Dimension, y: Dimension) {
    return new Dimension({
      number: Math.pow(x.value.number, y.value.number),
      unit: x.value.unit
    });
  },
  {
    params: [{
      name: 'x',
      type: Dimension
    }, {
      name: 'y',
      type: Dimension
    }]
  }
);
