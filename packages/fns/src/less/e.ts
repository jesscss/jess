import { Node, Quoted, defineFunction } from '@jesscss/core';

/**
 * Escape a quoted value
 */
const e = defineFunction(
  'e',
  function(value: Node) {
    if (value instanceof Quoted) {
      return value.data;
    }
    return value;
  },
  {
    params: [{
      name: 'value',
      type: Node
    }]
  }
);

export default e;