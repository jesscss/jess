import { Node, Quoted, defineFunction } from '@jesscss/core';

/**
 * Escape a quoted value
 */
const e = defineFunction(
  'e',
  function({ value }: { value: Node }) {
    if (value instanceof Quoted) {
      return value.value;
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