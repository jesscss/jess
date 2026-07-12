import { Any, defineFunction, Dimension } from '@jesscss/core';

const getUnit = defineFunction(
  'get-unit',
  function(value: Dimension) {
    return new Any(value.value.unit ?? '', { role: 'keyword' });
  },
  {
    params: [{
      name: 'value',
      type: Dimension
    }]
  }
);

export default getUnit;
