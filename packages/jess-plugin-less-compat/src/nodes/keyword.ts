import { Keyword } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy';
import { mapJessTypeToLessType } from '../transform/type-map';
import { fromLessNode } from '../transform/from-less';
import type { LessNode } from '../types';

/**
 * Transform a Jess Keyword to a Less-compatible Keyword
 */
export function transformKeywordToLess(
  jessKeyword: Keyword,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessKeyword, cache, (prop, target) => {
    const keyword = target as Keyword;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(keyword.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'value' property
    if (prop === 'value') {
      return keyword.value;
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessKeyword = transformKeywordToLess(keyword, cache);
        const result = visitor.visit(lessKeyword);
        if (result !== lessKeyword) {
          return fromLessNode(result, { cache });
        }
        return keyword;
      };
    }

    return undefined;
  });
}
