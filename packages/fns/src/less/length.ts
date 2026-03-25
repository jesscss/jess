import { defineFunction, Node, Dimension, coerceListItems } from '@jesscss/core';

const length = defineFunction(
  'length',
  function(value: Node): Dimension {
    const items = coerceListItems(value);
    return new Dimension({ number: items.length, unit: undefined });
  },
  {
    params: [{
      name: 'value',
      type: Node
    }]
  }
);

export default length;
