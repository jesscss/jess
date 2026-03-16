import { Condition, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { toLessNode } from '../transform/to-less.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import { fromLessNode } from '../transform/from-less.js';
import type { LessNode } from '../types.js';

/**
 * Transform a Jess Condition to a Less-compatible Condition
 */
export function transformConditionToLess(
  jessCondition: Condition,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessCondition, cache, (prop, target) => {
    const condition = target as Condition;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(condition.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'op' property (operator)
    // Condition.value is a tuple: [left, op?, right?]
    if (prop === 'op') {
      const [, op] = condition.data;
      return op || '';
    }

    // Map 'lvalue' property (left value)
    if (prop === 'lvalue') {
      const [left] = condition.data;
      if (left instanceof Node) {
        return toLessNode(left, { cache });
      }
      return left;
    }

    // Map 'rvalue' property (right value)
    if (prop === 'rvalue') {
      const [, , right] = condition.data;
      if (right instanceof Node) {
        return toLessNode(right, { cache });
      }
      return right;
    }

    // Map 'negate' property
    if (prop === 'negate') {
      return condition.negate === true;
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessCondition = transformConditionToLess(condition, cache);
        const result = visitor.visit(lessCondition);
        if (result !== lessCondition) {
          return fromLessNode(result, { cache });
        }
        return condition;
      };
    }

    return undefined;
  });
}
