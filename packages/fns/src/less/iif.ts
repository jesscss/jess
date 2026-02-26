import { defineFunction, Node, Bool, type Lazy } from '@jesscss/core';

/**
 * if condition, return ifValue, else return elseValue
 */
const iif = defineFunction(
  'if',
  async function(condition: Bool | boolean, thenValue: Lazy<Node>, elseValue?: Lazy<Node>) {
    let bool = typeof condition === 'boolean' ? condition : condition.value;
    if (bool) {
      return await thenValue();
    }
    if (elseValue) {
      return await elseValue();
    }
    return undefined;
  },
  {
    params: [{
      name: 'condition',
      type: [Bool, 'boolean']
    }, {
      name: 'thenValue',
      type: Node,
      lazy: true
    }, {
      name: 'elseValue',
      type: Node,
      optional: true,
      lazy: true
    }]
  }
);

export default iif;