import { Combinator } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy';
import { mapJessTypeToLessType } from '../transform/type-map';
import type { LessNode } from '../types';

/**
 * Transform a Jess Combinator to a Less-compatible Combinator
 */
export function transformCombinatorToLess(
  jessCombinator: Combinator,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessCombinator, cache, (prop, target) => {
    const combinator = target as Combinator;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(combinator.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'value' property
    if (prop === 'value') {
      return combinator.value;
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessCombinator = transformCombinatorToLess(combinator, cache);
        const result = visitor.visit(lessCombinator);
        if (result !== lessCombinator) {
          const { fromLessNode } = require('../transform/from-less');
          return fromLessNode(result, { cache });
        }
        return combinator;
      };
    }

    return undefined;
  });
}
