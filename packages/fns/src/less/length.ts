import { defineFunction, Node, List, Sequence, Dimension } from '@jesscss/core';

function getItems(value: Node): Node[] {
  if (value instanceof List && value.length === 1 && value.value[0] instanceof Sequence) {
    return value.value[0].value;
  }
  if (value instanceof List || value instanceof Sequence) {
    return value.value;
  }
  return [value];
}

const length = defineFunction(
  'length',
  function(value: Node): Dimension {
    const items = getItems(value);
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
