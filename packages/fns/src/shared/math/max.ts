import { defineFunction, Node, type Context } from '@jesscss/core';

/**
 * Return the maximum value
 */
const max = defineFunction(
  'max',
  function(this: Context, ...values: Node[]) {
    values = values.slice().sort((a, b) => {
      let compare = b.compare(a);
      if (compare === undefined) {
        throw new TypeError(`Cannot compare ${a.type} and ${b.type}`);
      }
      return compare;
    });
    return values[0];
  },
  {
    params: [{
      name: 'values',
      type: [Node, 'number'],
      rest: true
    }]
  }
);

export default max;
