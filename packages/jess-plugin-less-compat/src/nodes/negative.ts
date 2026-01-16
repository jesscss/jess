import { Negative, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy';
import { toLessNode } from '../transform/to-less';
import { mapJessTypeToLessType } from '../transform/type-map';
import { fromLessNode } from '../transform/from-less';
import type { LessNode } from '../types';

/**
 * Transform a Jess Negative to a Less-compatible Negative
 */
export function transformNegativeToLess(
  jessNegative: Negative,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessNegative, cache, (prop, target) => {
    const negative = target as Negative;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(negative.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'value' property
    if (prop === 'value') {
      const value = negative.value;
      if (value instanceof Node) {
        return toLessNode(value, { cache });
      }
      return value;
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessNegative = transformNegativeToLess(negative, cache);
        const result = visitor.visit(lessNegative);
        if (result !== lessNegative) {
          return fromLessNode(result, { cache });
        }
        return negative;
      };
    }

    return undefined;
  });
}
