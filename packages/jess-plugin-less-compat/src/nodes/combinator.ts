import { Combinator } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import type { LessNode } from '../types.js';

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
      return combinator.data;
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        // Less Combinator has no children, so accept() should just return the combinator
        // The visitor's visit() method will be called by the visitor itself
        // We don't need to call visitor.visit() here - that would create a loop
        // if the visitor's visit() method calls accept() again
        return combinator;
      };
    }

    return undefined;
  });
}
