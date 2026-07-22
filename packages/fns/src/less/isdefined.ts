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

/**
 * Less `isdefined()` — true when the lazily-evaluated argument resolves without a
 * `ReferenceError` (i.e. the reference exists). Other errors propagate.
 * @param value a lazily-evaluated expression
 * @returns a `Bool`
 */
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
