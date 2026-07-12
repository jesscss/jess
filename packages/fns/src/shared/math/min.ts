import { defineFunction, Node } from '@jesscss/core';

/**
 * Return the minimum value
 */
const min = defineFunction(
  'min',
  function(...values: Node[]): Node {
    values = values.sort((a, b) => {
      let compare = a.compare(b);
      if (compare === undefined) {
        throw new TypeError(`Cannot compare ${a.type} and ${b.type}`);
      }
      return compare;
    });
    return values[0]!;
  },
  {
    params: [{
      name: 'values',
      type: [Node, 'number'],
      rest: true
    }]
  }
);

export default min;
