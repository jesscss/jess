import { defineFunction, Node, Condition, Anonymous, type Lazy } from '@jesscss/core';

/**
 * if condition, return ifValue, else return elseValue.
 *
 * The condition is already evaluated to a value node: a `Bool` (from a
 * comparison / `and` / `or` / `not` guard expression), or a bare keyword
 * `true`/`false`. `Condition.getBoolValue` maps both to a boolean — the same
 * truthiness rule guards use.
 */
const iif = defineFunction(
  'if',
  async function(condition: Node | boolean, thenValue: Lazy<Node>, elseValue?: Lazy<Node>): Promise<Node> {
    const bool = typeof condition === 'boolean'
      ? condition
      : Condition.getBoolValue(condition, false);
    if (bool) {
      return await thenValue();
    }
    if (elseValue) {
      return await elseValue();
    }
    return new Anonymous('');
  },
  {
    params: [{
      name: 'condition',
      type: [Node, 'boolean']
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
