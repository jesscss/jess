import { defineFunction, Node, Bool, type Lazy } from '@jesscss/core';

export async function isdefinedImplementation(value: Lazy<Node>) {
  try {
    await value();
    return new Bool(true);
  } catch (error: unknown) {
    if (error instanceof ReferenceError) {
      return new Bool(false);
    }
    throw error;
  }
}

const isdefined = defineFunction(
  'isdefined',
  isdefinedImplementation,
  {
    params: [{
      name: 'value',
      type: Node,
      lazy: true
    }]
  }
);

export default isdefined;
