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

const isruleset = defineFunction(
  'isruleset',
  async function(value: Lazy<Node>) {
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
  },
  {
    params: [{
      name: 'value',
      type: Node,
      lazy: true
    }]
  }
);

export default isruleset;
