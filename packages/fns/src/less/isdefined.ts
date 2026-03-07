import { defineFunction, Node, Bool, type Lazy } from '@jesscss/core';

const isdefined = defineFunction(
  'isdefined',
  async function(value: Lazy<Node>) {
    try {
      await value();
      return new Bool(true);
    } catch (error: unknown) {
      if (error instanceof ReferenceError) {
        return new Bool(false);
      }
      throw error;
    }
  },
  {
    params: [{
      name: 'value',
      type: Node,
      lazy: true
    }]
  }
);

export default isdefined;
