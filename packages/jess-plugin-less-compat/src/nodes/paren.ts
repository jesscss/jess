import { Paren, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy';
import { toLessNode } from '../transform/to-less';
import { mapJessTypeToLessType } from '../transform/type-map';
import { fromLessNode } from '../transform/from-less';
import type { LessNode } from '../types';

/**
 * Transform a Jess Paren to a Less-compatible Paren
 */
export function transformParenToLess(
  jessParen: Paren,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessParen, cache, (prop, target) => {
    const paren = target as Paren;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(paren.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'value' property
    if (prop === 'value') {
      const value = paren.value;
      if (value instanceof Node) {
        return toLessNode(value, { cache });
      }
      return value;
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessParen = transformParenToLess(paren, cache);
        const result = visitor.visit(lessParen);
        if (result !== lessParen) {
          return fromLessNode(result, { cache });
        }
        return paren;
      };
    }

    return undefined;
  });
}
