import {
  defineFunction,
  Node,
  Bool,
  Rules,
  Ruleset,
  Mixin,
  Collection,
  type Lazy
} from '@jesscss/core';

export async function isrulesetImplementation(value: Lazy<Node>) {
  try {
    const resolved = await value();
    return new Bool(
      resolved instanceof Rules
      || resolved instanceof Ruleset
      || resolved instanceof Mixin
      || resolved instanceof Collection
    );
  } catch (error: unknown) {
    if (error instanceof ReferenceError) {
      return new Bool(false);
    }
    throw error;
  }
}

/**
 * Less `isruleset()` — true when the lazily-evaluated argument is a detached
 * ruleset / mixin / collection. A `ReferenceError` yields `false`.
 * @param value a lazily-evaluated expression
 * @returns a `Bool`
 */
const isruleset = defineFunction(
  'isruleset',
  isrulesetImplementation,
  {
    params: [{
      name: 'value',
      type: Node,
      lazy: true
    }]
  }
);

export default isruleset;
