import { List, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy';
import { toLessNode } from '../transform/to-less';
import { mapJessTypeToLessType } from '../transform/type-map';
import type { LessNode } from '../types';

/**
 * Transform a Jess List to a Less-compatible Value
 */
export function transformListToLess(
  jessList: List,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessList, cache, (prop, target) => {
    const list = target as List;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(list.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'value' property (Less Value expects array)
    if (prop === 'value') {
      const value = list.value;
      if (Array.isArray(value)) {
        return value.map((item: any) => {
          if (item instanceof Node) {
            return toLessNode(item, { cache });
          }
          return item;
        });
      }
      // Single value - wrap in array
      return [value];
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessList = transformListToLess(list, cache);
        const result = visitor.visit(lessList);
        if (result !== lessList) {
          const { fromLessNode } = require('../transform/from-less');
          return fromLessNode(result, { cache });
        }
        return list;
      };
    }

    return undefined;
  });
}
